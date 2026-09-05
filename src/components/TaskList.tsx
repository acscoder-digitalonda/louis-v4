'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Task } from '@/lib/types'
import { dayMonth, daysUntil } from '@/lib/format'

export function TaskList({ tasks, canEdit }: { tasks: Task[]; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})

  async function toggle(task: Task) {
    const next = !(optimistic[task.id] ?? task.done)
    setOptimistic((o) => ({ ...o, [task.id]: next }))
    setBusy(task.id)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { done: next } }),
      })
      if (!res.ok) setOptimistic((o) => ({ ...o, [task.id]: !next }))
      else router.refresh()
    } finally {
      setBusy(null)
    }
  }

  if (tasks.length === 0) {
    return <p className="body-copy text-ink-secondary">No open tasks.</p>
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const done = optimistic[task.id] ?? task.done
        const days = daysUntil(task.dueDate)
        const overdue = days !== null && days < 0 && !done
        return (
          <li key={task.id} className="flex items-start gap-3">
            <button
              type="button"
              className={`mt-[2px] h-4 w-4 flex-none rounded border ${
                done ? 'border-accent bg-accent' : 'border-hairline-strong'
              }`}
              onClick={() => canEdit && void toggle(task)}
              disabled={!canEdit || busy === task.id}
              aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
            />
            <div className="min-w-0 flex-1">
              <div className={`body-copy ${done ? 'text-ink-muted line-through' : ''}`}>
                {task.title}
              </div>
              <div className="sub mt-[2px]">
                {task.source} · due {dayMonth(task.dueDate)}
                {overdue ? <span className="text-danger"> · overdue</span> : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
