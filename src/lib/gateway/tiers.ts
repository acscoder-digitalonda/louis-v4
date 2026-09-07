/**
 * The task vocabulary and the tier each one runs at by default.
 *
 * Its own file because both the gateway and the mode dial need it, and having them import
 * it from each other made a cycle that only showed itself at runtime: `modes.ts` built
 * the Economy map from `TASK_TIERS` at module scope, and got `undefined` because
 * `index.ts` had not finished initialising. Four test suites failed with
 * "Cannot access 'TASK_TIERS' before initialization" and nothing type-checked wrong.
 */

import type { ModelTier } from '../types'

export type TaskKind =
  | 'classify'
  | 'dedupe'
  | 'normalize'
  | 'check'
  | 'qa'
  | 'extract'
  | 'research'
  | 'draft'
  | 'escalate'
  | 'weekly-review'

/** The tier map, encoded (Rebuild Spec §3). */
export const TASK_TIERS: Record<TaskKind, ModelTier> = {
  classify: 'haiku',
  dedupe: 'haiku',
  normalize: 'haiku',
  check: 'haiku',
  qa: 'haiku',
  extract: 'sonnet',
  research: 'sonnet',
  draft: 'sonnet',
  escalate: 'opus',
  'weekly-review': 'opus',
}

