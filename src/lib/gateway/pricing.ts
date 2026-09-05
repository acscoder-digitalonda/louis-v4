/**
 * Cost estimation for the usage meter.
 *
 * These are per-million-token prices used to turn tokens into dollars for the meter.
 * They are a local table on purpose: the meter must keep working when a provider's
 * response omits cost. Where a backend *does* report real spend, that number wins —
 * see `estimated` on the Usage Log row.
 *
 * Update these when provider pricing changes; nothing else depends on them.
 */

export interface Price {
  /** USD per million input tokens. */
  in: number
  /** USD per million output tokens. */
  out: number
}

const PRICES: { match: RegExp; price: Price }[] = [
  { match: /haiku/i, price: { in: 1, out: 5 } },
  { match: /sonnet/i, price: { in: 3, out: 15 } },
  { match: /opus/i, price: { in: 15, out: 75 } },
  { match: /gemini.*flash/i, price: { in: 0.3, out: 2.5 } },
  { match: /gemini/i, price: { in: 1.25, out: 10 } },
  { match: /gpt-4o-mini|gpt-5-mini/i, price: { in: 0.25, out: 2 } },
  { match: /gpt/i, price: { in: 2.5, out: 10 } },
]

const DEFAULT_PRICE: Price = { in: 3, out: 15 }

export function priceFor(model: string): Price {
  return PRICES.find((p) => p.match.test(model))?.price ?? DEFAULT_PRICE
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = priceFor(model)
  const cost = (tokensIn / 1_000_000) * price.in + (tokensOut / 1_000_000) * price.out
  // Sub-cent precision matters at Haiku volumes.
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** Rough token count for backends that report none. Deliberately conservative. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}
