/**
 * Weighted forecast (WP0.2 — SpeakerOS weights, adopted wholesale).
 *
 * Inquiry 25 · Qualified 50 · Firm Offer 95 · Closed-Won and beyond 100 · Closed Lost 0.
 *
 * Two things changed from v3 and both are deliberate. The curve is now **purely
 * stage-driven**: v3 read a `proposalSent` checkbox to move 25 → 65, which meant the
 * forecast depended on someone remembering to tick a box. A priced offer being out is
 * exactly what Firm Offer means, so the stage already carries it.
 *
 * And Inquiry is 25, not 0. That is SpeakerOS's number: an inquiry that reached a human
 * is worth something, and a pipeline that reports zero until a hold exists understates
 * what is actually in play.
 *
 * Still derived, never stored — there is no field for a human to get wrong, and changing
 * the curve is a change to `speaker.config` only.
 */

import type { Deal, DealWithDerived } from './types'
import { stageByKey } from '~/speaker.config'

export function forecastWeight(deal: Pick<Deal, 'stage'>): number {
  return stageByKey.get(deal.stage)?.weight ?? 0
}

export function dealValue(deal: Pick<Deal, 'listFee' | 'negotiatedFee'>): number {
  return deal.negotiatedFee ?? deal.listFee ?? 0
}

export function withDerived(deal: Deal): DealWithDerived {
  const weight = forecastWeight(deal)
  return {
    ...deal,
    forecastWeight: weight,
    forecastValue: Math.round((dealValue(deal) * weight) / 100),
  }
}

export interface PipelineTotals {
  gross: number
  weighted: number
  count: number
}

export function pipelineTotals(deals: Deal[]): PipelineTotals {
  return deals.reduce<PipelineTotals>(
    (acc, deal) => {
      const derived = withDerived(deal)
      acc.gross += dealValue(deal)
      acc.weighted += derived.forecastValue
      acc.count += 1
      return acc
    },
    { gross: 0, weighted: 0, count: 0 },
  )
}
