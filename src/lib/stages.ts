/**
 * Stage packets — the data F5 fires on (Rebuild Spec §5, "pure automation, no AI").
 *
 * A packet is declarative on purpose: what tasks to create, what drafts to propose,
 * what to mirror, and what must be true before the deal may enter the stage. Changing
 * how a stage behaves is a data edit here, not a rewrite of the engine.
 *
 * The mini pipeline in the UI renders from the same packet, so the checklist a human
 * sees and the work the engine creates can never drift apart.
 *
 * ── WP0.2, what changed from v3 ────────────────────────────────────────────
 *
 * Selling split in two. v3's single `sales` packet placed a hold, booked the call and
 * sent the proposal in one lump. SpeakerOS separates **Qualified** (a hold is out, we are
 * still selling) from **Firm Offer** (a priced offer is out, and the clock is theirs) —
 * because the 24-hour first-right-of-refusal challenge fires on the second one, and a
 * merged stage has no moment to fire it on.
 *
 * `dormant` became **Closed Lost**, which carries a reason, which is the key the 12-month
 * re-engagement campaign segments on.
 *
 * And packets now branch on **lane**. On a bureau deal the agent owns the relationship:
 * nothing addressed to the end client is drafted, the kit goes to the agent, and the
 * debrief only happens with the agent's buy-in. That is a rule from Ben's actual process,
 * not a preference — automating past a bureau agent is how a speaker loses a bureau.
 */

import type { Deal, DealSource, DraftType, StageKey } from './types'
import { speaker, stageByKey, stagesForType } from '~/speaker.config'

export interface PacketTask {
  title: string
  /** Days from the trigger (negative = before the event date). */
  dueInDays?: number
  dueRelativeToEvent?: number
  assignee?: 'ops' | 'owner' | 'admin'
  /** Restrict to one lane. Omitted = both. */
  lane?: DealSource
}

export interface PacketDraft {
  type: DraftType
  templateKey: string
  /** The ack is the one whitelisted auto-send in the whole system (F1). */
  autoSend?: boolean
  /** Restrict to one lane. Omitted = both. */
  lane?: DealSource
}

export interface StagePacket {
  stage: StageKey
  /** The mini-pipeline strip shown inside the deal. */
  checklist: string[]
  tasks: PacketTask[]
  drafts: PacketDraft[]
  mirror: ('calendar' | 'doc' | 'sheet' | 'drive')[]
  /** Returns a blocking reason, or null if the deal may enter this stage. */
  guard?: (deal: Deal) => string | null
}

export const STAGE_PACKETS: Record<StageKey, StagePacket> = {
  inquiry: {
    stage: 'inquiry',
    checklist: ['inquiry logged', 'auto-ack sent', 'research brief', 'qualified'],
    tasks: [{ title: 'Review research brief and qualify', dueInDays: 1, assignee: 'ops' }],
    // The bureau lane has no form and no auto-ack: the agent wrote to a person and
    // expects a person. A robot reply to an agent reads as a robot.
    drafts: [{ type: 'ack', templateKey: 'ack.inquiry', autoSend: true, lane: 'direct' }],
    mirror: ['sheet'],
  },

  qualified: {
    stage: 'qualified',
    checklist: ['hold placed', 'pitch call booked', 'call held'],
    tasks: [
      { title: 'Place hold on the date', dueInDays: 1, assignee: 'ops' },
      { title: 'Book the pitch call', dueInDays: 3, assignee: 'ops' },
    ],
    drafts: [],
    mirror: ['calendar', 'sheet'],
  },

  'firm-offer': {
    stage: 'firm-offer',
    checklist: ['proposal sent', 'decision date set', 'follow-up armed'],
    tasks: [
      { title: 'Send proposal', dueInDays: 1, assignee: 'ops' },
      { title: 'Set the decision date', dueInDays: 1, assignee: 'ops' },
    ],
    drafts: [{ type: 'proposal', templateKey: 'proposal.standard' }],
    mirror: ['calendar', 'sheet'],
    // A firm offer with no number in it is not a firm offer, and it is what the
    // competing-hold challenge measures against.
    // `!= null` on purpose, so a field that is absent rather than explicitly null is
    // still caught. A deal object built from a partial patch has `undefined` there, and
    // `!== null` would wave it straight through the gate.
    guard: (deal) =>
      typeof deal.negotiatedFee === 'number' || typeof deal.listFee === 'number'
        ? null
        : 'Firm Offer needs a fee — it is the offer, and the hold challenge compares against it.',
  },

  'closed-won': {
    stage: 'closed-won',
    checklist: ['contract out', 'contract signed', 'deposit invoiced', 'deal folder created'],
    tasks: [
      { title: 'Send contract', dueInDays: 1, assignee: 'ops' },
      { title: 'Invoice the deposit', dueInDays: 2, assignee: 'ops' },
    ],
    // The kit is NOT here. Its trigger is a sequence: Closed-Won, then contract signed,
    // then invoice shared, and only then the kit (Gap Analysis §2). F6 fires it.
    drafts: [],
    mirror: ['calendar', 'doc', 'drive', 'sheet'],
  },

  'pre-event': {
    stage: 'pre-event',
    checklist: [
      'questionnaire returned',
      'AV check confirmed',
      'travel booked',
      'run-of-show received',
      'debrief booked',
      'journal decided',
    ],
    tasks: [
      { title: 'Confirm AV check window with the venue', dueRelativeToEvent: -21, assignee: 'ops' },
      { title: 'Book travel and hotel', dueRelativeToEvent: -21, assignee: 'ops' },
      { title: 'Chase run-of-show', dueRelativeToEvent: -14, assignee: 'ops' },
      { title: 'Confirm journal quantities with the warehouse', dueRelativeToEvent: -35, assignee: 'ops' },
      { title: 'Send the field guide to Ben', dueRelativeToEvent: -3, assignee: 'ops' },
      // Debrief is booked at kick-off, not proposed at Closed-Won (Gap Analysis §2).
      { title: 'Book the debrief on the kick-off call', dueRelativeToEvent: -30, assignee: 'ops' },
    ],
    drafts: [{ type: 'chase', templateKey: 'chase.questionnaire' }],
    mirror: ['calendar', 'doc', 'drive', 'sheet'],
    // The one hard gate in the pipeline: money says signed, or the deal does not advance.
    guard: (deal) =>
      deal.contractStatus === 'signed'
        ? null
        : 'Contract is not signed yet — Pre-Event is gated on the money lookup.',
  },

  delivered: {
    stage: 'delivered',
    checklist: ['keynote delivered', 'post-keynote notes', 'balance invoiced', 'debrief drafted'],
    tasks: [
      { title: 'Write post-keynote notes', dueInDays: 1, assignee: 'owner' },
      { title: 'Invoice the balance', dueInDays: 2, assignee: 'ops' },
    ],
    drafts: [{ type: 'debrief', templateKey: 'debrief.thankyou' }],
    mirror: ['doc', 'sheet'],
  },

  debriefed: {
    stage: 'debriefed',
    checklist: ['testimonial asked', 'rebooking floated', 'journal tail closed', 'folder archived'],
    tasks: [
      { title: 'Ask for a testimonial', dueInDays: 3, assignee: 'ops' },
      { title: 'Float a rebooking for next year', dueInDays: 30, assignee: 'ops' },
    ],
    drafts: [],
    mirror: ['sheet'],
  },

  'closed-lost': {
    stage: 'closed-lost',
    checklist: ['reason recorded', 're-engagement armed'],
    // No chasing task: the deal is over. The only future action is the campaign, and
    // that is driven off Closed Lost Reason twelve months out by WP1.7.
    tasks: [{ title: 'Record why it was lost', dueInDays: 1, assignee: 'ops' }],
    drafts: [],
    mirror: ['sheet'],
    guard: (deal) =>
      deal.closedLostReason
        ? null
        : 'Closed Lost needs a reason — it is what the twelve-month re-engagement segments on.',
  },
}

/** Board order, Closed Lost last and collapsed. */
export const BOARD_STAGES: StageKey[] = speaker.stages
  .filter((s) => !s.collapsed)
  .sort((a, b) => a.order - b.order)
  .map((s) => s.key)

export const ALL_STAGES: StageKey[] = [...speaker.stages]
  .sort((a, b) => a.order - b.order)
  .map((s) => s.key)

/** The two stages a deal does not come back from. Timers and digests skip them. */
export const TERMINAL_STAGES: StageKey[] = speaker.stages.filter((s) => s.terminal).map((s) => s.key)

export function isTerminal(stage: StageKey): boolean {
  return TERMINAL_STAGES.includes(stage)
}

/**
 * The stages where a date is actually being held, which is what the calendar renders as
 * a HOLD and what a competing hold challenges.
 */
export function isHold(stage: StageKey): boolean {
  return stage === 'qualified' || stage === 'firm-offer'
}

export function stageIndex(stage: StageKey): number {
  return ALL_STAGES.indexOf(stage)
}

/**
 * True when the move skips a stage — the UI asks for confirmation first.
 *
 * Measured against the stages *this deal type actually uses*, so a coaching deal going
 * Qualified → Closed-Won is a normal step and not a skip: coaching has no Firm Offer to
 * skip over.
 */
export function isSkip(from: StageKey, to: StageKey, dealType?: string | null): boolean {
  if (isTerminal(to) || isTerminal(from)) return false
  const path = stagesForType(dealType)
  const a = path.indexOf(from)
  const b = path.indexOf(to)
  if (a < 0 || b < 0) return false
  return b - a > 1
}

export function guardStage(deal: Deal, to: StageKey): string | null {
  const allowed = stagesForType(deal.dealType)
  if (!allowed.includes(to)) {
    const label = stageByKey.get(to)?.label ?? to
    return `${label} is not a stage a ${deal.dealType ?? 'keynote'} deal uses.`
  }
  return STAGE_PACKETS[to].guard?.(deal) ?? null
}

/** The tasks and drafts of a packet, filtered to the lane this deal is in. */
export function packetFor(stage: StageKey, lane: DealSource): {
  tasks: PacketTask[]
  drafts: PacketDraft[]
} {
  const packet = STAGE_PACKETS[stage]
  return {
    tasks: packet.tasks.filter((t) => !t.lane || t.lane === lane),
    drafts: packet.drafts.filter((d) => !d.lane || d.lane === lane),
  }
}
