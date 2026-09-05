import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canWrite } from '@/lib/rbac'
import { humanActor, recordChanges } from '@/lib/audit'
import { fail, ok } from '@/lib/http'
import type { Task } from '@/lib/types'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  patch: z.object({
    done: z.boolean().optional(),
    title: z.string().max(300).optional(),
    dueDate: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
  }),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireUser()
    const decision = canWrite(user.role, 'tasks')
    if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'You cannot edit tasks.')

    const { patch } = patchSchema.parse(await request.json())
    const provider = db()
    const before = (await provider.listTasks()).find((t) => t.id === id)
    if (!before) return ok({ error: 'Task not found.' }, { status: 404 })

    const task = await provider.updateTask(id, patch as Partial<Task>)
    await recordChanges({
      table: 'tasks',
      recordId: id,
      before: before as unknown as Record<string, unknown>,
      after: patch,
      actor: humanActor(user.email),
    })
    return ok({ task })
  } catch (err) {
    return fail(err)
  }
}
