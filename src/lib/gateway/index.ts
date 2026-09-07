/**
 * The AI gateway (Rebuild Spec §6, Handoff §7).
 *
 * One function — `complete(task, input)` — so the rest of the system never names a
 * provider. Inside: tier routing (Opus → Sonnet → Haiku by task, never by vibe),
 * automatic same-tier fallback to a second provider, a Usage Log row after *every*
 * call including failures, and a monthly cap that pauses research and QA while intake
 * and timers keep running.
 *
 * The backend is a setting, not a deploy: `claude-code` (local runner, Phase 0) or
 * `openrouter` (API-billed, the production path).
 */

import { db } from '../data'
import { notify, notifyWorkerFailure } from '../notify'
import type { AiBackend, AiSettings, ModelTier } from '../types'
import { estimateCost } from './pricing'
import { runClaudeCode } from './claude-code'
import { runOpenRouter } from './openrouter'
import { isMode, tierFor } from './modes'
import type { TaskKind } from './tiers'

export type { TaskKind } from './tiers'
export { TASK_TIERS } from './tiers'

/** Workers that keep running once the cap is hit. Everything else pauses. */
export const CRITICAL_TASKS: TaskKind[] = ['classify', 'extract', 'check']

export interface CompleteOptions {
  /** Which worker is calling — lands in the Usage Log and in failure notifications. */
  worker: string
  task: TaskKind
  system?: string
  input: string
  /** Escalate to the next tier up (F3: Sonnet self-reports low confidence). */
  escalate?: boolean
  dealId?: string | null
  maxTokens?: number
  /** JSON mode: the caller expects a parseable object back. */
  json?: boolean
}

export interface CompletionResult {
  text: string
  model: string
  tier: ModelTier
  backend: AiBackend
  tokensIn: number
  tokensOut: number
  estCost: number
  estimated: boolean
  durationMs: number
  usedFallback: boolean
}

export class GatewayPaused extends Error {
  constructor(readonly capUsd: number) {
    super(`Monthly AI cap of $${capUsd} reached — non-critical tasks are paused.`)
    this.name = 'GatewayPaused'
  }
}

export class GatewayFailure extends Error {
  constructor(
    message: string,
    readonly attempts: string[],
  ) {
    super(message)
    this.name = 'GatewayFailure'
  }
}

export interface ProviderCall {
  model: string
  system?: string
  input: string
  maxTokens: number
  json: boolean
}

export interface ProviderResult {
  text: string
  tokensIn: number
  tokensOut: number
  /** True when the backend cannot report real spend (subscription runs). */
  estimated: boolean
}

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus']

function escalateTier(tier: ModelTier): ModelTier {
  const next = TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)]
  return next ?? tier
}

export async function complete(opts: CompleteOptions): Promise<CompletionResult> {
  const provider = db()
  const settings = (await provider.getSettings()).ai
  // The mode dial decides which tier a task runs at; escalation still moves it one up
  // from whatever the mode chose, so a Sonnet that reports low confidence in Steady
  // reaches Opus, and one in Economy reaches Sonnet.
  const mode = isMode(settings.mode) ? settings.mode : 'steady'
  const base = tierFor(opts.task, mode)
  const tier = opts.escalate ? escalateTier(base) : base

  await assertUnderCap(settings, opts.task)

  const primary = settings.tierModels[tier]
  const fallback = settings.fallbackModels[tier]
  const attempts: string[] = []

  // Primary, then one retry, then the same-tier fallback model.
  const plan: { model: string; backend: AiBackend; isFallback: boolean }[] = [
    { model: primary, backend: settings.backend, isFallback: false },
    { model: primary, backend: settings.backend, isFallback: false },
    { model: fallback, backend: 'openrouter', isFallback: true },
  ]

  for (const step of plan) {
    if (!step.model) continue
    // The fallback is an OpenRouter model id; without a key there is nothing to fall back to.
    if (step.backend === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
      attempts.push(`${step.model}: no OPENROUTER_API_KEY`)
      continue
    }

    const startedAt = Date.now()
    try {
      const result = await callProvider(step.backend, {
        model: step.model,
        system: opts.system,
        input: opts.input,
        maxTokens: opts.maxTokens ?? 2048,
        json: opts.json ?? false,
      })
      const durationMs = Date.now() - startedAt
      const estCost = estimateCost(step.model, result.tokensIn, result.tokensOut)

      await provider.appendUsage({
        at: new Date().toISOString(),
        worker: opts.worker,
        task: opts.task,
        model: step.model,
        tier,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estCost,
        backend: step.backend,
        dealId: opts.dealId ?? null,
        durationMs,
        ok: true,
        error: null,
        estimated: result.estimated,
      })

      return {
        text: result.text,
        model: step.model,
        tier,
        backend: step.backend,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estCost,
        estimated: result.estimated,
        durationMs,
        usedFallback: step.isFallback,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      attempts.push(`${step.model}: ${message}`)
      // Never silent: a failed call is a Usage Log row too.
      await provider.appendUsage({
        at: new Date().toISOString(),
        worker: opts.worker,
        task: opts.task,
        model: step.model,
        tier,
        tokensIn: 0,
        tokensOut: 0,
        estCost: 0,
        backend: step.backend,
        dealId: opts.dealId ?? null,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: message.slice(0, 500),
        estimated: false,
      })
    }
  }

  // Primary and fallback both failed — queue it and tell an admin. Nothing drops.
  const failure = new GatewayFailure(
    `All model attempts failed for ${opts.worker}/${opts.task}`,
    attempts,
  )
  await notifyWorkerFailure({
    worker: `${opts.worker} (${opts.task})`,
    error: failure,
    logTail: attempts.join('\n'),
  })
  throw failure
}

export type ProviderRunner = (backend: AiBackend, call: ProviderCall) => Promise<ProviderResult>

let runnerOverride: ProviderRunner | null = null

/**
 * Test seam, mirroring `setProvider` for the data layer.
 *
 * It exists because the default backend is `claude-code`, which *shells out to the
 * Claude CLI*. Without this, any test that composes a draft spawns a real model call:
 * slow, non-deterministic, and billed. On CI there is no `claude` binary at all, so the
 * call would fall through to the OpenRouter fallback, find no key, and queue — a test
 * passing for the wrong reason.
 */
export function setProviderRunner(fn: ProviderRunner | null): void {
  runnerOverride = fn
}

async function callProvider(backend: AiBackend, call: ProviderCall): Promise<ProviderResult> {
  if (runnerOverride) return runnerOverride(backend, call)
  return backend === 'claude-code' ? runClaudeCode(call) : runOpenRouter(call)
}

// ── Cap handling ────────────────────────────────────────────────────────────

export interface UsageWindow {
  spend: number
  calls: number
  errors: number
}

export async function monthToDate(): Promise<UsageWindow> {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const rows = await db().listUsage(start.toISOString())
  return rows.reduce<UsageWindow>(
    (acc, row) => {
      acc.spend += row.estCost
      acc.calls += 1
      if (!row.ok) acc.errors += 1
      return acc
    },
    { spend: 0, calls: 0, errors: 0 },
  )
}

let capWarned = false

async function assertUnderCap(settings: AiSettings, task: TaskKind): Promise<void> {
  if (!settings.monthlyCapUsd) return
  const { spend } = await monthToDate()

  if (spend >= settings.monthlyCapUsd * 0.8 && !capWarned) {
    capWarned = true
    await notify({
      type: 'cap-warning',
      title: `AI spend at ${Math.round((spend / settings.monthlyCapUsd) * 100)}% of the monthly cap`,
      body: `$${spend.toFixed(2)} of $${settings.monthlyCapUsd.toFixed(2)}. Research and QA pause at 100%; intake and timers keep running.`,
      link: '/settings?tab=ai',
      roles: ['admin'],
    })
  }

  if (spend >= settings.monthlyCapUsd && settings.pauseNonCriticalAtCap && !CRITICAL_TASKS.includes(task)) {
    throw new GatewayPaused(settings.monthlyCapUsd)
  }
}

/** Test seam — the warn-once latch is per-process. */
export function resetCapWarning(): void {
  capWarned = false
}

export { estimateCost }
