/**
 * E17 — the post-keynote alert.
 *
 * Ben comes offstage, opens the deal on his phone, and ticks one box. That tick is the
 * whole handoff: it puts what happened in the room in front of the office while it is
 * still fresh, and it is the raw material for the thank-you note, the testimonial ask and
 * the journal conversation that follow.
 *
 * ── Why the tick and the notes are handled separately ──────────────────────
 *
 * The realistic sequence is not "type notes, then tick". It is: tick from the room with
 * nothing typed, then write the notes in the car an hour later. A rule that only fires on
 * the tick would deliver an empty alert and never mention it again, which is worse than
 * not having the feature — the office would learn the alert says nothing.
 *
 * So there are two triggers. The tick sends what exists, saying plainly when that is
 * nothing. Notes edited afterwards on an already-alerted deal send a short update. Both
 * are internal; neither drafts anything to a client.
 */

import type { Deal } from './types'

export type AlertReason = 'ticked' | 'notes-updated'

/**
 * Whether this patch is a send, and which kind.
 *
 * Fires on the false→true edge only. Saving a deal whose box is already ticked is not a
 * send, or every logistics edit for the rest of the deal's life would re-alert.
 */
export function alertReason(
  before: Pick<Deal, 'postKeynoteAlert' | 'postKeynoteNotes'>,
  patch: Record<string, unknown>,
): AlertReason | null {
  if (patch.postKeynoteAlert === true && !before.postKeynoteAlert) return 'ticked'

  if (!before.postKeynoteAlert) return null
  if (!('postKeynoteNotes' in patch)) return null

  const next = typeof patch.postKeynoteNotes === 'string' ? patch.postKeynoteNotes.trim() : ''
  // An edit that empties the notes is not news, and neither is a no-op save.
  if (!next || next === (before.postKeynoteNotes ?? '').trim()) return null
  return 'notes-updated'
}

/**
 * The message.
 *
 * Internal and plain. The deal name in the subject is what makes it findable a month
 * later when somebody is writing the case study.
 */
export function alertMessage(
  deal: Pick<Deal, 'id' | 'name' | 'client' | 'postKeynoteNotes'>,
  reason: AlertReason,
): { title: string; body: string } {
  const who = deal.client?.name ?? deal.name
  const notes = deal.postKeynoteNotes?.trim()

  return {
    title: reason === 'ticked' ? `Post-keynote — ${who}` : `Post-keynote notes updated — ${who}`,
    body: notes
      ? `Ben's post-keynote notes for ${deal.name}:\n\n${notes}`
      : // Said out loud rather than sent blank. He ticked from the room; the notes are
        // coming, and somebody should ask for them today rather than in a fortnight.
        `Ben ticked the post-keynote alert for ${deal.name} with no notes written yet.\n\n` +
        'Ask him while he still remembers the room — the thank-you note and the ' +
        'testimonial ask both come out of what he says here.',
  }
}
