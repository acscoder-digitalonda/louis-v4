import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canWrite } from '@/lib/rbac'
import { humanActor, recordEvent } from '@/lib/audit'
import { isSafeColor } from '@/lib/theme'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

const colorMap = z.record(z.string().refine(isSafeColor, 'Colours must be hex or rgb().'))

import { DEFAULT_QUIET_HOURS, type QuietHours } from '@/lib/quiet-hours'
import { speaker } from '~/speaker.config'

const patchSchema = z.object({
  theme: z.object({ light: colorMap, dark: colorMap }).partial().optional(),
  ai: z
    .object({
      backend: z.enum(['claude-code', 'openrouter']),
      tierModels: z.object({ haiku: z.string(), sonnet: z.string(), opus: z.string() }),
      fallbackModels: z.object({ haiku: z.string(), sonnet: z.string(), opus: z.string() }),
      monthlyCapUsd: z.number().min(0).max(100_000),
      pauseNonCriticalAtCap: z.boolean(),
      // WP3.1 — the mode dial. Validated as an enum so a typo cannot silently put the
      // gateway on a tier map that does not exist.
      mode: z.enum(['launch', 'steady', 'economy']),
    })
    .partial()
    .optional(),
  // WP3.2 — hours are 0-23 and may wrap past midnight, which is the normal case.
  quietHours: z
    .object({
      from: z.number().int().min(0).max(23),
      to: z.number().int().min(0).max(23),
      timezone: z.string().min(1),
      enabled: z.boolean(),
    })
    .partial()
    .optional(),
})

export async function GET() {
  try {
    await requireUser()
    return ok({ settings: await db().getSettings() })
  } catch (err) {
    return fail(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'settings')
    if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'Settings are admin-only.')

    const input = patchSchema.parse(await request.json())
    const current = await db().getSettings()

    const settings = await db().saveSettings({
      theme: input.theme
        ? { light: input.theme.light ?? current.theme.light, dark: input.theme.dark ?? current.theme.dark }
        : undefined,
      ai: input.ai ? { ...current.ai, ...input.ai } : undefined,
      quietHours: input.quietHours
        ? {
            ...DEFAULT_QUIET_HOURS,
            timezone: speaker.timezone,
            ...((current as unknown as { quietHours?: QuietHours }).quietHours ?? {}),
            ...input.quietHours,
          }
        : undefined,
    } as never)

    await recordEvent({
      table: 'settings',
      recordId: 'settings',
      what: 'Settings updated',
      detail: Object.keys(input).join(', '),
      actor: humanActor(user.email),
    })

    return ok({ settings })
  } catch (err) {
    return fail(err)
  }
}
