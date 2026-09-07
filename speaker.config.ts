/**
 * SPEAKER CONFIG — the white-label seam (Rebuild Spec §8).
 *
 * Every speaker-specific value in the whole system lives in this one file.
 * Stamping a new install = fork the repo, edit this file, run `npm run base:bootstrap`.
 * If you ever find a speaker's name, fee, colour or phrase hardcoded in `src/`, that is a bug.
 */

/**
 * The eight-stage spine (Add-On Run Plan, WP0.2).
 *
 * v3 had one `sales` stage and a `dormant` graveyard. SpeakerOS splits selling into
 * **Qualified** (a hold is out) and **Firm Offer** (a priced offer is out), because the
 * 24-hour first-right-of-refusal challenge fires on the second one and cannot be
 * expressed without it. `dormant` becomes **Closed Lost**, which carries a reason, which
 * is what the 12-month re-engagement campaign segments on.
 */
export type StageKey =
  | 'inquiry'
  | 'qualified'
  | 'firm-offer'
  | 'closed-won'
  | 'pre-event'
  | 'delivered'
  | 'debriefed'
  | 'closed-lost'

/**
 * Deal types (WP0.1). Coaching skips Firm Offer: there is no date being held, so there
 * is nothing for a competing hold to challenge.
 */
export type DealTypeKey = 'keynote' | 'speaker-coaching' | 'executive-coaching'

export interface DealTypeDefinition {
  key: DealTypeKey
  label: string
  /** Stages this type may enter, in order. */
  stages: StageKey[]
}

export interface StageDefinition {
  key: StageKey
  /** Display label — a speaker may rename stages without touching the engine. */
  label: string
  /** Weighted-forecast percentage floor for this stage (Rebuild Spec §2.3). */
  weight: number
  /** Board column order. Closed Lost is collapsed and sits last. */
  order: number
  collapsed?: boolean
  /** True for the two stages that end a deal. Timers and digests skip them. */
  terminal?: boolean
}

export interface SpeakerConfig {
  /** Short id — used for storage keys and the base template name. */
  id: string
  /** Wordmark rendered in the top bar; the accent period is added by the component. */
  wordmark: string
  speakerName: string
  /** Internal team domain — all notification email stays inside it. */
  teamDomain: string
  /** Reply-to / service address the Gmail worker sends from. */
  serviceAddress: string
  currency: string
  locale: string
  timezone: string
  fees: {
    defaultList: number
    /** Floor below which a negotiated fee raises a warning in the Sales tab. */
    floor: number
  }
  stages: StageDefinition[]
  dealTypes: DealTypeDefinition[]
  /** Accent overrides applied on top of the shipped token defaults (Handoff §2.3). */
  accents: {
    light: Record<string, string>
    dark: Record<string, string>
  }
  /** Seed allowlist. The Airtable Users table is authoritative once it exists. */
  seedAdmins: string[]
  drive: {
    /** Root folder name created by the mirror worker (Data Map, Domain 5). */
    root: string
  }
}

export const speaker: SpeakerConfig = {
  id: 'louis',
  wordmark: 'LOUIS',
  speakerName: 'Ben Nemtin',
  teamDomain: 'bennemtin.com',
  serviceAddress: 'ops@bennemtin.com',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'America/Los_Angeles',
  fees: {
    defaultList: 35000,
    floor: 20000,
  },
  // Weights are SpeakerOS's, adopted wholesale: stage-driven, no proposal-sent checkbox.
  stages: [
    { key: 'inquiry', label: 'Inquiry', weight: 25, order: 0 },
    { key: 'qualified', label: 'Qualified', weight: 50, order: 1 },
    { key: 'firm-offer', label: 'Firm Offer', weight: 95, order: 2 },
    { key: 'closed-won', label: 'Closed-Won', weight: 100, order: 3 },
    { key: 'pre-event', label: 'Pre-Event', weight: 100, order: 4 },
    { key: 'delivered', label: 'Delivered', weight: 100, order: 5 },
    { key: 'debriefed', label: 'Debriefed', weight: 100, order: 6, terminal: true },
    { key: 'closed-lost', label: 'Closed Lost', weight: 0, order: 7, collapsed: true, terminal: true },
  ],

  dealTypes: [
    {
      key: 'keynote',
      label: 'Keynote',
      stages: ['inquiry', 'qualified', 'firm-offer', 'closed-won', 'pre-event', 'delivered', 'debriefed', 'closed-lost'],
    },
    // Coaching has no held date, so no Firm Offer and no Pre-Event logistics packet.
    // The run plan says only "coaching skips Firm Offer"; dropping Pre-Event as well is
    // an inference, and it is listed for Jordan rather than buried here.
    {
      key: 'speaker-coaching',
      label: 'Speaker Coaching',
      stages: ['inquiry', 'qualified', 'closed-won', 'delivered', 'debriefed', 'closed-lost'],
    },
    {
      key: 'executive-coaching',
      label: 'Executive Coaching',
      stages: ['inquiry', 'qualified', 'closed-won', 'delivered', 'debriefed', 'closed-lost'],
    },
  ],
  accents: {
    light: {},
    dark: {},
  },
  seedAdmins: ['jordan@bennemtin.com', 'acscoder@digitalonda.com'],
  drive: {
    root: 'Louis',
  },
}

export const stageByKey = new Map(speaker.stages.map((s) => [s.key, s]))

export const stageOrder: StageKey[] = [...speaker.stages]
  .sort((a, b) => a.order - b.order)
  .map((s) => s.key)

export const dealTypeByKey = new Map(speaker.dealTypes.map((t) => [t.key, t]))

/** The stages a deal of this type may enter. Unknown or unset type falls back to keynote. */
export function stagesForType(type: string | null | undefined): StageKey[] {
  const fallback = speaker.dealTypes[0]!.stages
  if (!type) return fallback
  return dealTypeByKey.get(type as DealTypeKey)?.stages ?? fallback
}

export default speaker
