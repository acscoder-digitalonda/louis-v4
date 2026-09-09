/**
 * Worker registry.
 *
 * Each entry is runnable two ways: from the CLI (`npm run worker <name>`) and from
 * `/api/cron/<name>`, which is what Vercel Cron hits. Same function either way — there
 * is no "the scheduled version" that drifts from "the one you can test".
 *
 * `critical` marks the workers that keep running when the AI cap is hit.
 */

import * as emailIntake from './f2-email-intake'
import * as research from './f3-research'
import * as timers from './f6-timers'
import * as mirror from './f9-mirror'
import * as qa from './f13-qa-sweep'
import * as sla from './f14-sla'

export interface WorkerDef {
  name: string
  title: string
  /** Suggested cron expression — mirrored in vercel.json. */
  schedule: string
  critical: boolean
  run: () => Promise<unknown>
}

export const WORKERS: Record<string, WorkerDef> = {
  'f2-email-intake': {
    name: 'f2-email-intake',
    title: 'Email intake',
    // Hourly. A quiet sweep costs ten Airtable requests, and four an hour was thirty
    // thousand a month spent confirming there was no mail — on a plan billed per request.
    //
    // This is safe to slow down only because the reply clock now starts at the moment the
    // client's email says it arrived, not at the moment this sweep noticed it. Measuring
    // from discovery would mean the one-hour promise could be kept by sweeping less often,
    // which is the opposite of keeping it.
    schedule: '0 * * * *',
    critical: true,
    run: emailIntake.run,
  },
  'f3-research': {
    name: 'f3-research',
    title: 'Research agent',
    schedule: '0 8 * * *',
    critical: false,
    run: research.run,
  },
  'f6-timers': {
    name: 'f6-timers',
    title: 'Timers',
    schedule: '0 7 * * *',
    critical: true,
    run: timers.run,
  },
  'f9-mirror': {
    name: 'f9-mirror',
    title: 'Google mirror',
    schedule: '0 * * * *',
    critical: true,
    run: mirror.run,
  },
  'f13-qa-sweep': {
    name: 'f13-qa-sweep',
    title: 'QA sweep',
    schedule: '30 5 * * *',
    critical: false,
    run: qa.run,
  },
  'f14-sla': {
    name: 'f14-sla',
    title: 'Reply SLA',
    // Hourly, and free during quiet hours: the clock it watches does not run at night.
    schedule: '0 * * * *',
    critical: true,
    run: sla.run,
  },
}

export const WORKER_NAMES = Object.keys(WORKERS)
