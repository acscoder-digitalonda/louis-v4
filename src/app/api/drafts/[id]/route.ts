import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canApproveSends } from '@/lib/rbac'
import { recordEvent, humanActor } from '@/lib/audit'
import { createGmailDraft, sendMail } from '@/lib/mailer'
import { invalidateSearchCache } from '@/lib/search'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

const actionSchema = z.object({
  action: z.enum(['approve', 'dismiss', 'save']),
  subject: z.string().max(400).optional(),
  body: z.string().max(20_000).optional(),
})

/**
 * Approve is where the human-in-the-loop rule lives.
 *
 * "Approve" marks the draft approved and puts the final text in the mailbox as a Gmail
 * draft attributed to the approver. It does **not** send to the client: the last click
 * is a person's, in their own mail client, every time. `SEND_ON_APPROVE=true` exists for
 * installs that decide otherwise, and it is off by default for a reason.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireUser()
    if (!canApproveSends(user.role)) {
      throw new ForbiddenError('Your role cannot approve or dismiss drafts.')
    }

    const input = actionSchema.parse(await request.json())
    const provider = db()
    const draft = await provider.getDraft(id)
    if (!draft) return ok({ error: 'Draft not found.' }, { status: 404 })

    const subject = input.subject ?? draft.subject
    const body = input.body ?? draft.body
    const edited = subject !== draft.subject || body !== draft.body

    // Outbound versioning: what the human changed before send is kept on the record.
    const revisions = edited
      ? [
          ...draft.revisions,
          { at: new Date().toISOString(), by: user.email, subject: draft.subject, body: draft.body },
        ]
      : draft.revisions

    if (input.action === 'dismiss') {
      await provider.updateDraft(id, { status: 'dismissed', approver: user.email, revisions })
      await recordEvent({
        table: 'drafts',
        recordId: id,
        what: 'Dismissed',
        detail: draft.subject,
        actor: humanActor(user.email),
      })
      invalidateSearchCache()
      return ok({ ok: true })
    }

    if (input.action === 'save') {
      await provider.updateDraft(id, { subject, body, revisions })
      return ok({ ok: true })
    }

    const sendDirectly = process.env.SEND_ON_APPROVE === 'true'
    let threadId = draft.threadId

    if (draft.toEmail) {
      if (sendDirectly) {
        await sendMail({ to: draft.toEmail, subject, text: body })
      } else {
        const gmail = await createGmailDraft({ to: draft.toEmail, subject, text: body })
        threadId = gmail.threadId ?? threadId
      }
    }

    await provider.updateDraft(id, {
      subject,
      body,
      revisions,
      threadId,
      approver: user.email,
      status: sendDirectly ? 'sent' : 'approved',
      sentAt: sendDirectly ? new Date().toISOString() : null,
    })

    await recordEvent({
      table: 'drafts',
      recordId: id,
      what: sendDirectly ? 'Sent' : 'Approved',
      detail: `${draft.type} → ${draft.toEmail ?? 'no recipient'}${edited ? ' (edited)' : ''}`,
      actor: humanActor(user.email),
    })

    invalidateSearchCache()
    return ok({ ok: true, sent: sendDirectly })
  } catch (err) {
    return fail(err)
  }
}
