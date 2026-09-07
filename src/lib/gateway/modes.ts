/**
 * WP3.1 — the mode dial.
 *
 * One switch that changes what every worker is allowed to spend, because the right answer
 * is different in the first month than in the tenth.
 *
 *   **LAUNCH**  — get it right while nobody trusts it yet. The best model reads intent,
 *                 extracts fields, researches and drafts. Expensive on purpose: a wrong
 *                 extraction in week one is a wrong deal in the pipeline, and the cost of
 *                 unpicking that is far more than the difference between two models.
 *
 *   **STEADY**  — the shipped default. Cheap models do the mechanical work, mid models
 *                 read and write, and only escalation and the weekly review reach for the
 *                 top. This is the tier map the Rebuild Spec describes.
 *
 *   **ECONOMY** — everything drops a tier. For a month where the bill matters more than
 *                 the polish, or for running against a base you are about to throw away.
 *
 * ── What the dial does not do ──────────────────────────────────────────────
 *
 * It never changes *which* tasks run. Turning the dial down makes the drafts plainer; it
 * does not stop the inbox being swept, and it does not quietly disable a check. The thing
 * that pauses work is the cap, and that is a separate mechanism with its own list of what
 * survives it (`CRITICAL_TASKS`).
 */

import type { ModelTier } from '../types'
import { TASK_TIERS, type TaskKind } from './tiers'

export type ModeKey = 'launch' | 'steady' | 'economy'

export const MODES: ModeKey[] = ['launch', 'steady', 'economy']

export interface ModeDefinition {
  key: ModeKey
  label: string
  /** One line, shown on the dial. Says what changes, not how it feels. */
  summary: string
  /** Per-task overrides. Anything absent falls through to the STEADY map. */
  tiers: Partial<Record<TaskKind, ModelTier>>
}

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus']

function down(tier: ModelTier): ModelTier {
  return TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)]!
}

export const MODE_DEFINITIONS: Record<ModeKey, ModeDefinition> = {
  launch: {
    key: 'launch',
    label: 'Launch',
    summary: 'Best model on intent, extraction, research and drafts. Costs more, gets more right.',
    tiers: {
      extract: 'opus',
      research: 'opus',
      draft: 'opus',
      escalate: 'opus',
      'weekly-review': 'opus',
      // Classification stays cheap even here: it is a yes/no on 45 threads and the
      // expensive model is no better at it, so the money would buy nothing.
      classify: 'haiku',
    },
  },
  steady: {
    key: 'steady',
    label: 'Steady',
    summary: 'The shipped tier map: cheap for mechanical work, mid for reading and writing.',
    tiers: {},
  },
  economy: {
    key: 'economy',
    label: 'Economy',
    summary: 'Everything drops one tier. Plainer drafts, same coverage, roughly a third of the cost.',
    tiers: Object.fromEntries(
      (Object.keys(TASK_TIERS) as TaskKind[]).map((task) => [task, down(TASK_TIERS[task])]),
    ) as Partial<Record<TaskKind, ModelTier>>,
  },
}

export function isMode(value: unknown): value is ModeKey {
  return typeof value === 'string' && (MODES as string[]).includes(value)
}

/**
 * The tier a task runs at in a given mode.
 *
 * Falls through to the shipped map rather than requiring every mode to list every task,
 * so adding a task kind cannot silently leave a mode with a hole in it.
 */
export function tierFor(task: TaskKind, mode: ModeKey = 'steady'): ModelTier {
  return MODE_DEFINITIONS[mode].tiers[task] ?? TASK_TIERS[task]
}

/** The whole map for a mode, for the settings screen and the MCP tool. */
export function tierMap(mode: ModeKey): Record<TaskKind, ModelTier> {
  const out = {} as Record<TaskKind, ModelTier>
  for (const task of Object.keys(TASK_TIERS) as TaskKind[]) out[task] = tierFor(task, mode)
  return out
}

/**
 * Roughly what a mode costs relative to Steady.
 *
 * Deliberately rough, and labelled as such wherever it is shown: the real number depends
 * on how much mail arrives, and a precise-looking estimate would be trusted more than it
 * deserves. What it is good for is the shape — Launch is several times Steady, Economy is
 * a fraction of it — which is the decision the dial is actually for.
 */
export function relativeCost(mode: ModeKey): number {
  const weight: Record<ModelTier, number> = { haiku: 1, sonnet: 12, opus: 60 }
  const cost = (m: ModeKey) =>
    (Object.keys(TASK_TIERS) as TaskKind[]).reduce((n, t) => n + weight[tierFor(t, m)], 0)
  return Math.round((cost(mode) / cost('steady')) * 10) / 10
}
