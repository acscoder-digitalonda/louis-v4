import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canConfirmPayments } from '@/lib/rbac'
import { humanActor, recordEvent } from '@/lib/audit'
import { notify } from '@/lib/notify'
import { money } from '@/lib/format'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

const actionSchema = z.object({ action: z.enum(['confirm', 'reject']) })

/**
 * Payments are human-confirmed only. The matcher proposes; this route is the person.
 * Confirming flips the record, which is what the Deal's Payment Status lookup reads —
 * there is no sync worker in the loop, so the chip is live by definition.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireUser()
    if (!canConfirmPayments(user.role)) {
      throw new ForbiddenError('Only the money group confirms payments.')
    }

    const { action } = actionSchema.parse(await request.json())
    const provider = db()
    const payment = (await provider.listPayments()).find((p) => p.id === id)
    if (!payment) return ok({ error: 'Payment not found.' }, { status: 404 })

    if (action === 'reject') {
      await provider.updatePayment(id, { note: `${payment.note ?? ''}\nRejected by ${user.email}`.trim() })
      await recordEvent({
        table: 'payments',
        recordId: id,
        what: 'Match rejected',
        detail: payment.invoiceNumber,
        actor: humanActor(user.email),
      })
      return ok({ ok: true })
    }

    const updated = await provider.updatePayment(id, {
      status: 'confirmed',
      confirmedBy: user.email,
      receivedDate: payment.receivedDate ?? new Date().toISOString().slice(0, 10),
    })

    await recordEvent({
      table: 'payments',
      recordId: id,
      what: 'Payment confirmed',
      detail: `${payment.invoiceNumber ?? 'no ref'} · ${money(payment.amount)}`,
      actor: humanActor(user.email),
    })

    await notify({
      type: 'payment-confirmed',
      title: `Payment confirmed — ${money(payment.amount)}`,
      body: payment.invoiceNumber ?? undefined,
      link: payment.dealId ? `/deals/${payment.dealId}?tab=money` : '/money',
      roles: ['admin', 'ops', 'owner'],
    })

    return ok({ payment: updated })
  } catch (err) {
    return fail(err)
  }
}
