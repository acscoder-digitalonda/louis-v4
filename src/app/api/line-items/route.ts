import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { agentActor, humanActor, recordEvent } from '@/lib/audit'
import { canWrite } from '@/lib/rbac'
import { fulfillmentFor } from '@/lib/fulfillment'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Deal line items (WP1.1) and the Fulfillment record a physical one needs (WP1.4).
 *
 * The two are created together, in that order, deliberately. Decisions Log §2 has the
 * fulfillment record appear "when the line item is added" rather than on a nightly sweep,
 * because the gap between somebody ordering 2,000 journals and somebody noticing is
 * exactly where a print run dies.
 *
 * A workshop gets no fulfillment record. It has nothing to ship, and a record with no
 * shipment is a row on a board that never closes.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'dealLineItems')
    if (!decision.allowed) return ok({ error: decision.reason }, { status: 403 })

    const body = (await request.json()) as {
      dealId?: string
      productId?: string
      quantity?: number
      priceOverride?: number | null
      notes?: string | null
    }
    if (!body.dealId || !body.productId) {
      return ok({ error: 'A line item needs a deal and a product.' }, { status: 400 })
    }

    const provider = db()
    const [deal, products] = await Promise.all([provider.getDeal(body.dealId), provider.listProducts()])
    if (!deal) return ok({ error: 'No such deal.' }, { status: 404 })

    const product = products.find((p) => p.id === body.productId)
    if (!product) return ok({ error: 'No such product.' }, { status: 404 })

    const lineItem = await provider.createLineItem({
      dealId: body.dealId,
      productId: product.id,
      productName: product.name,
      quantity: Math.max(1, Math.round(body.quantity ?? 1)),
      // Null and zero are different: null means "use the product price", zero means
      // "given, not sold", which is how Dream fulfilment is booked.
      priceOverride: body.priceOverride ?? null,
      lineTotal: null,
      notes: body.notes ?? null,
    })

    await recordEvent({
      table: 'deals',
      recordId: deal.id,
      what: 'Line item added',
      detail: `${lineItem.quantity} × ${product.name}`,
      actor: humanActor(user.email),
      reversible: true,
    })

    const spec = fulfillmentFor(lineItem, product, deal)
    let fulfillment = null
    if (spec) {
      fulfillment = await provider.createFulfillment(spec)
      await recordEvent({
        table: 'deals',
        recordId: deal.id,
        what: 'Fulfillment opened',
        detail: `${product.name}, ship by ${spec.shipBy ?? 'no event date yet'}`,
        actor: agentActor('WP1.4'),
      })
    }

    return ok({ lineItem, fulfillment })
  } catch (err) {
    return fail(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'dealLineItems')
    if (!decision.allowed) return ok({ error: decision.reason }, { status: 403 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return ok({ error: 'Which line item?' }, { status: 400 })

    // The fulfillment record is left standing on purpose. If a run is already with the
    // warehouse, deleting the line item must not make the shipment disappear from the
    // board — somebody still has to decide what happens to the boxes.
    await db().deleteLineItem(id)
    return ok({ deleted: id })
  } catch (err) {
    return fail(err)
  }
}
