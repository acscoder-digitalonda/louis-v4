/**
 * Stage packets — the data F5 fires on (Rebuild Spec §5, "pure automation, no AI").
 *
 * A packet is declarative on purpose: what tasks to create, what drafts to propose,
 * what to mirror, and what must be true before the deal may enter the stage. Changing
 * how a stage behaves is a data edit here, not a rewrite of the engine.
 *
 * The mini pipeline in the UI renders from the same packet, so the checklist a human
 * sees and the work the engine creates can never drift apart.
 */

import type { Deal, DraftType, StageKey } from './types'

export interface PacketTask {
  title: string
  /** Days from the trigger (negative = before the event date). */
  dueInDays?: number
  dueRelativeToEvent?: number
  assignee?: 'ops' | 'owner' | 'admin'
}

export interface PacketDraft {
  type: DraftType
  templateKey: string
  /** The ack is the one whitelisted auto-send in the whole system (F1). */
  autoSend?: boolean
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
    drafts: [{ type: 'ack', templateKey: 'ack.inquiry', autoSend: true }],
    mirror: ['sheet'],
  },

  sales: {
    stage: 'sales',
    checklist: ['hold placed', 'pitch call', 'proposal sent', 'decision date set', 'follow-up armed'],
    tasks: [
      { title: 'Place hold on the date', dueInDays: 1, assignee: 'ops' },
      { title: 'Book the pitch call', dueInDays: 3, assignee: 'ops' },
      { title: 'Send proposal', dueInDays: 5, assignee: 'ops' },
      { title: 'Set the decision date', dueInDays: 5, assignee: 'ops' },
    ],
    drafts: [{ type: 'proposal', templateKey: 'proposal.standard' }],
    mirror: ['calendar', 'sheet'],
  },

  'closed-won': {
    stage: 'closed-won',
    checklist: ['contract out', 'contract signed', 'deposit invoiced', 'deal folder created'],
    tasks: [
      { title: 'Send contract', dueInDays: 1, assignee: 'ops' },
      { title: 'Invoice the deposit', dueInDays: 2, assignee: 'ops' },
      { title: 'Send the welcome kit + questionnaire', dueInDays: 2, assignee: 'ops' },
    ],
    drafts: [{ type: 'kit', templateKey: 'kit.welcome' }],
    mirror: ['calendar', 'doc', 'drive', 'sheet'],
  },

  'pre-event': {
    stage: 'pre-event',
    checklist: [
      'questionnaire returned',
      'AV check confirmed',
      'travel booked',
      'run-of-show received',
      'journal decided',
    ],
    tasks: [
      { title: 'Confirm AV check window with the venue', dueRelativeToEvent: -21, assignee: 'ops' },
      { title: 'Book travel and hotel', dueRelativeToEvent: -21, assignee: 'ops' },
      { title: 'Chase run-of-show', dueRelativeToEvent: -14, assignee: 'ops' },
      { title: 'Confirm journal quantities with the warehouse', dueRelativeToEvent: -35, assignee: 'ops' },
      { title: 'Send the field guide to Ben', dueRelativeToEvent: -3, assignee: 'ops' },
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

  dormant: {
    stage: 'dormant',
    checklist: ['parked', 'revisit date set'],
    tasks: [{ title: 'Revisit this deal', dueInDays: 90, assignee: 'ops' }],
    drafts: [],
    mirror: ['sheet'],
  },
}

/** Board order, Dormant last and collapsed. */
export const BOARD_STAGES: StageKey[] = [
  'inquiry',
  'sales',
  'closed-won',
  'pre-event',
  'delivered',
  'debriefed',
]

export const ALL_STAGES: StageKey[] = [...BOARD_STAGES, 'dormant']

export function stageIndex(stage: StageKey): number {
  return ALL_STAGES.indexOf(stage)
}

/** True when the move skips a stage — the UI asks for confirmation first. */
export function isSkip(from: StageKey, to: StageKey): boolean {
  if (to === 'dormant' || from === 'dormant') return false
  return stageIndex(to) - stageIndex(from) > 1
}

export function guardStage(deal: Deal, to: StageKey): string | null {
  return STAGE_PACKETS[to].guard?.(deal) ?? null
}
