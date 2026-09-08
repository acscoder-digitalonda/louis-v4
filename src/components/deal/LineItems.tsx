'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Micro } from '@/components/ui'
import { money } from '@/lib/format'
import type { DealLineItem, Product } from '@/lib/types'

/**
 * Deal line items (WP1.1), and the fulfillment record a physical one opens (WP1.4).
 *
 * The screen says what will happen before it happens: picking the journal shows that a
 * fulfillment record will open and that the ship-by comes from the event date. Adding
 * 2,000 journals and discovering a week later that a warehouse deadline exists is the
 * failure this whole work package is for.
 */
export function LineItems({
  dealId,
  items,
  products,
  showAmounts,
  canEdit,
}: {
  dealId: string
  items: DealLineItem[]
  products: Product[]
  showAmounts: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [override, setOverride] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = products.find((p) => p.id === productId)
  const unit = override.trim() === '' ? (chosen?.unitPrice ?? 0) : Number(override)
  const total = Number.isFinite(unit) ? unit * quantity : 0

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/line-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId,
          productId,
          quantity,
          // An empty box means "use the product price"; a typed zero means "given, not
          // sold", which is how Dream fulfilment is booked. They are different states,
          // so an empty string is not quietly coerced to 0.
          priceOverride: override.trim() === '' ? null : Number(override),
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not add it.')
        return
      }
      setOverride('')
      setQuantity(1)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: DealLineItem) {
    if (!window.confirm(`Remove ${item.quantity} × ${item.productName ?? 'this line'}?`)) return
    setBusy(true)
    try {
      await fetch(`/api/line-items?id=${item.id}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const addOn = items.reduce((n, i) => n + (i.lineTotal ?? 0), 0)

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Micro>Line items</Micro>
        {showAmounts && items.length > 0 ? (
          <span className="sub num">add-ons {money(addOn)}</span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="body-copy text-ink-secondary">
          Nothing added. Journals, the book and workshops are line items rather than fields, so
          the money rolls up into the deal and the warehouse gets a record of its own.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="rowname truncate">
                  {i.quantity} × {i.productName ?? 'Unknown product'}
                </div>
                {i.priceOverride !== null ? (
                  <div className="sub">
                    price overridden to {money(i.priceOverride)}
                    {i.priceOverride === 0 ? ' · given, not sold' : ''}
                  </div>
                ) : null}
              </div>
              {showAmounts ? (
                <span className="num text-[13px]">{money(i.lineTotal ?? 0)}</span>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="pill pill-ghost"
                  disabled={busy}
                  onClick={() => void remove(i)}
                >
                  remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && products.length > 0 ? (
        <div className="mt-4 border-t pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <Micro>Product</Micro>
              <select
                className="field-input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.unitPrice ? ` · ${money(p.unitPrice)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1">
              <Micro>Qty</Micro>
              <input
                type="number"
                min={1}
                className="field-input"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              />
            </label>
            <label className="flex w-32 flex-col gap-1">
              <Micro>Price override</Micro>
              <input
                className="field-input"
                placeholder={chosen?.unitPrice ? String(chosen.unitPrice) : 'none'}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="pill pill-accent"
              disabled={busy || !productId}
              onClick={() => void add()}
            >
              {busy ? 'adding…' : 'Add'}
            </button>
          </div>

          {chosen ? (
            <p className="sub mt-2">
              {showAmounts ? `${money(total)}. ` : ''}
              {chosen.physical
                ? 'Physical, so a fulfillment record opens with it and the ship-by comes from the event date.'
                : 'Not physical, so nothing ships and no fulfillment record opens.'}
            </p>
          ) : null}
          {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
        </div>
      ) : canEdit ? (
        <p className="sub mt-4 border-t pt-4">
          No products seeded yet. Run <code>npm run seed:pricing -- --apply</code>.
        </p>
      ) : null}
    </div>
  )
}
