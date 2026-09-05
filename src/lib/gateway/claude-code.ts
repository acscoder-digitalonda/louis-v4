/**
 * Phase 0 transport — the local Claude Code runner.
 *
 * Shells out to `claude -p … --output-format json` and parses the usage block out of
 * the result, so the cost meter learns the real burn rate before anyone flips the
 * backend to OpenRouter. Subscription-covered runs are logged with `estimated: true`
 * and shown in the meter as "est. — covered by Max plan"; pretending otherwise would
 * make the number a lie.
 *
 * This transport needs a shell, so it runs on the worker host (or a local dev machine),
 * not on Vercel serverless. Flipping Settings → AI → backend to `openrouter` is what
 * makes the cron endpoints self-sufficient.
 */

import { approximateTokens } from './pricing'
import type { ProviderCall, ProviderResult } from './index'

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 120_000)

interface ClaudeCliResult {
  result?: string
  is_error?: boolean
  usage?: { input_tokens?: number; output_tokens?: number }
  total_cost_usd?: number
}

export async function runClaudeCode(call: ProviderCall): Promise<ProviderResult> {
  const { spawn } = await import('node:child_process')
  const bin = process.env.CLAUDE_CODE_BIN ?? 'claude'

  const args = ['-p', '--output-format', 'json', '--model', call.model]
  if (call.system) args.push('--append-system-prompt', call.system)

  const prompt = call.json
    ? `${call.input}\n\nRespond with a single JSON object and nothing else.`
    : call.input

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`claude-code timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`claude-code could not start (${bin}): ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // A non-zero exit is a logged failure, never a silent empty result.
      if (code !== 0) reject(new Error(`claude-code exited ${code}: ${err.slice(0, 300)}`))
      else resolve(out)
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })

  let parsed: ClaudeCliResult
  try {
    parsed = JSON.parse(stdout) as ClaudeCliResult
  } catch {
    throw new Error(`claude-code returned unparseable output: ${stdout.slice(0, 300)}`)
  }
  if (parsed.is_error) throw new Error(`claude-code reported an error: ${parsed.result ?? 'unknown'}`)

  const text = parsed.result ?? ''
  if (!text) throw new Error('claude-code returned an empty result')

  return {
    text,
    tokensIn: parsed.usage?.input_tokens ?? approximateTokens(call.input + (call.system ?? '')),
    tokensOut: parsed.usage?.output_tokens ?? approximateTokens(text),
    // Cost is covered by the subscription, so the meter shows an equivalent, labelled.
    estimated: true,
  }
}
