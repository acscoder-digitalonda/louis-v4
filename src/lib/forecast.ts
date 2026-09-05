/**
 * Weighted forecast (Rebuild Spec §2.3).
 *
 * Inquiry, no hold → 0% · Sales + hold → 25% · Sales + proposal sent → 65% ·
 * Closed-Won and beyond → 100%. Derived, never stored: there is no field for a
 * human to get wrong, and changing the curve is a change to this function only.
 */

import type { Deal, DealWithDerived } from './types'
import { stageByKey } from '~/speaker.config'

export function forecastWeight(deal: Pick<Deal, 'stage' | 'holdDate' | 'proposalSent'>): number {
  switch (deal.stage) {
    case 'inquiry':
      return deal.holdDate ? 25 : 0
    case 'sales':
      if (deal.proposalSent) return 65
      return deal.holdDate ? 25 : 0
    case 'closed-won':
    case 'pre-event':
    case 'delivered':
    case 'debriefed':
      return 100
    case 'dormant':
      return 0
    default:
      return stageByKey.get(deal.stage)?.weight ?? 0
  }
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
