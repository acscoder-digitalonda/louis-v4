/**
 * OpenRouter transport — the production path.
 *
 * Deliberate deviation, documented in the spec: OpenRouter *is* the interchangeable-AI
 * layer. One key, one bill, provider-agnostic prompts, and a second provider available
 * for the fallback tier without a second integration. Everything still goes through
 * `complete()`, so swapping OpenRouter itself later touches this file alone.
 */

import { approximateTokens } from './pricing'
import type { ProviderCall, ProviderResult } from './index'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 60_000)

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

export async function runOpenRouter(call: ProviderCall): Promise<ProviderResult> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // OpenRouter attribution headers — optional, but they make the dashboard readable.
        'HTTP-Referer': process.env.NEXTAUTH_URL ?? 'https://louis.local',
        'X-Title': 'Louis v3',
      },
      body: JSON.stringify({
        model: call.model,
        max_tokens: call.maxTokens,
        ...(call.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          ...(call.system ? [{ role: 'system', content: call.system }] : []),
          { role: 'user', content: call.input },
        ],
      }),
    })

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }

    const json = (await res.json()) as OpenRouterResponse
    if (json.error) throw new Error(`OpenRouter error: ${json.error.message ?? 'unknown'}`)

    const text = json.choices?.[0]?.message?.content ?? ''
    if (!text) throw new Error('OpenRouter returned an empty completion')

    return {
      text,
      tokensIn: json.usage?.prompt_tokens ?? approximateTokens(call.input + (call.system ?? '')),
      tokensOut: json.usage?.completion_tokens ?? approximateTokens(text),
      estimated: json.usage?.prompt_tokens === undefined,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Daily credits check surfaced on the usage meter. */
export async function creditsRemaining(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } }
    const total = json.data?.total_credits
    const used = json.data?.total_usage
    if (total === undefined || used === undefined) return null
    return Math.round((total - used) * 100) / 100
  } catch {
    return null
  }
}
