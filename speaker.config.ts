/**
 * SPEAKER CONFIG — the white-label seam (Rebuild Spec §8).
 *
 * Every speaker-specific value in the whole system lives in this one file.
 * Stamping a new install = fork the repo, edit this file, run `npm run base:bootstrap`.
 * If you ever find a speaker's name, fee, colour or phrase hardcoded in `src/`, that is a bug.
 */

export type StageKey =
  | 'inquiry'
  | 'sales'
  | 'closed-won'
  | 'pre-event'
  | 'delivered'
  | 'debriefed'
  | 'dormant'

export interface StageDefinition {
  key: StageKey
  /** Display label — a speaker may rename stages without touching the engine. */
  label: string
  /** Weighted-forecast percentage floor for this stage (Rebuild Spec §2.3). */
  weight: number
  /** Board column order. Dormant is collapsed and sits last. */
  order: number
  collapsed?: boolean
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
  stages: [
    { key: 'inquiry', label: 'Inquiry', weight: 0, order: 0 },
    { key: 'sales', label: 'Sales', weight: 25, order: 1 },
    { key: 'closed-won', label: 'Closed-Won', weight: 100, order: 2 },
    { key: 'pre-event', label: 'Pre-Event', weight: 100, order: 3 },
    { key: 'delivered', label: 'Delivered', weight: 100, order: 4 },
    { key: 'debriefed', label: 'Debriefed', weight: 100, order: 5 },
    { key: 'dormant', label: 'Dormant', weight: 0, order: 6, collapsed: true },
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

export default speaker
