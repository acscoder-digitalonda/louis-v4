import { Micro } from '@/components/ui'
import { money } from '@/lib/format'
import { rateRegionCodec, secondaryTypeCodec, weekendRuleCodec } from '@/lib/data/airtable-codec'
import type { RateCard } from '@/lib/types'

/**
 * Settings → Pricing (WP2.3).
 *
 * Read-only on purpose. Decisions Log §4 makes the rate card *data* precisely so a price
 * change is a cell edit in Airtable rather than a deploy, and putting an editor here
 * would create a second place to change a number — which is how two numbers end up
 * disagreeing. This screen exists to show what the engine will actually use.
 *
 * The one thing it does add is the open question: Jordan's §5 asks Ben to confirm the
 * overseas weekend cells, which are seeded at zero on the reading that an overseas trip
 * consumes the weekend in travel anyway. A zero that nobody has confirmed looks exactly
 * like a zero somebody meant, so it says so.
 */
export function RateCardTable({ cards }: { cards: RateCard[] }) {
  if (cards.length === 0) {
    return (
      <div className="card">
        <Micro>No rate cards</Micro>
        <p className="body-copy mt-2">
          Nothing is seeded yet, so every deal reports no list price rather than a price of
          zero. Run <code>npm run seed:pricing -- --apply</code> to load the 2026 rows from
          Decisions Log §4.
        </p>
      </div>
    )
  }

  const unconfirmed = cards.filter((c) => c.weekendRule === 'none' && (c.travelBuyout ?? 0) === 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <Micro>2026 rate card · {cards.length} row(s)</Micro>
        <div className="scroll-x mt-3">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="micro">
                <th className="pb-2 pr-4">Region</th>
                <th className="pb-2 pr-4">Format</th>
                <th className="pb-2 pr-4 text-right">Base</th>
                <th className="pb-2 pr-4 text-right">Weekend</th>
                <th className="pb-2 pr-4">Rule</th>
                <th className="pb-2 pr-4 text-right">Travel</th>
                <th className="pb-2">Terms</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className="border-t align-top">
                  <td className="py-2 pr-4">
                    {c.rateRegion ? rateRegionCodec.toAirtable(c.rateRegion) : 'Any'}
                  </td>
                  <td className="py-2 pr-4">{secondaryTypeCodec.toAirtable(c.secondaryType)}</td>
                  <td className="num py-2 pr-4 text-right">{money(c.baseFee ?? 0)}</td>
                  <td className="num py-2 pr-4 text-right">
                    {c.weekendSurcharge ? money(c.weekendSurcharge) : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {c.weekendRule ? weekendRuleCodec.toAirtable(c.weekendRule) : '—'}
                  </td>
                  <td className="num py-2 pr-4 text-right">
                    {c.travelBuyout ? money(c.travelBuyout) : '—'}
                  </td>
                  <td className="sub py-2">{c.travelTerms || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub mt-3">
          Edited in Airtable, not here. One place to change a price is what stops two prices
          disagreeing.
        </p>
      </div>

      {unconfirmed.length > 0 ? (
        <div className="card border-warning">
          <Micro>Waiting on Ben</Micro>
          <p className="body-copy mt-1">
            {unconfirmed.length} overseas row(s) carry no weekend surcharge and no travel buyout,
            on the reading that an overseas trip consumes the weekend in travel anyway. That is
            Jordan&rsquo;s open item, and a zero nobody has confirmed looks exactly like a zero
            somebody meant.
          </p>
        </div>
      ) : null}
    </div>
  )
}
