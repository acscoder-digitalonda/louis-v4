import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canWrite } from '@/lib/rbac'
import { humanActor, recordEvent } from '@/lib/audit'
import { isSafeColor } from '@/lib/theme'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

const colorMap = z.record(z.string().refine(isSafeColor, 'Colours must be hex or rgb().'))

const patchSchema = z.object({
  theme: z.object({ light: colorMap, dark: colorMap }).partial().optional(),
  ai: z
    .object({
      backend: z.enum(['claude-code', 'openrouter']),
      tierModels: z.object({ haiku: z.string(), sonnet: z.string(), opus: z.string() }),
      fallbackModels: z.object({ haiku: z.string(), sonnet: z.string(), opus: z.string() }),
      monthlyCapUsd: z.number().min(0).max(100_000),
      pauseNonCriticalAtCap: z.boolean(),
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
    })

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
