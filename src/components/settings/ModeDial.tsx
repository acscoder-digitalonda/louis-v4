'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Micro } from '@/components/ui'
import { MODES, MODE_DEFINITIONS, relativeCost, tierMap, type ModeKey } from '@/lib/gateway/modes'

/**
 * Settings → AI → the mode dial (WP3.1).
 *
 * Three positions, and the screen shows the whole tier map for each so the choice is made
 * on what changes rather than on the name. The cost figure is deliberately labelled as a
 * rough multiple: the real number depends on how much mail arrives, and a precise-looking
 * estimate would be trusted further than it deserves.
 */
export function ModeDial({ current, canEdit }: { current: ModeKey; canEdit: boolean }) {
  const router = useRouter()
  const [selected, setSelected] = useState<ModeKey>(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const map = tierMap(selected)
  const cost = relativeCost(selected)
  const dirty = selected !== current

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: { mode: selected } }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not save.')
        return
      }
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Micro>Mode</Micro>
        {dirty ? (
          <button
            type="button"
            className="pill pill-accent"
            disabled={!canEdit || saving}
            onClick={() => void save()}
          >
            {saving ? 'saving…' : `Switch to ${MODE_DEFINITIONS[selected].label}`}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSelected(m)}
            className={`pill ${selected === m ? 'pill-accent' : 'pill-ghost'}`}
          >
            {MODE_DEFINITIONS[m].label}
            {m === current ? <span className="pill-count">live</span> : null}
          </button>
        ))}
      </div>

      <p className="body-copy mt-3">{MODE_DEFINITIONS[selected].summary}</p>
      <p className="sub mt-1">
        Roughly {cost}× the cost of Steady. A rough multiple: what it actually costs depends
        on how much mail arrives.
      </p>

      <div className="well mt-3 p-3">
        <Micro>What runs where</Micro>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
          {Object.entries(map).map(([task, tier]) => (
            <div key={task} className="flex items-baseline justify-between gap-2">
              <span className="sub truncate">{task}</span>
              <span className="num text-[12px]">{tier}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="sub mt-3">
        The dial changes which model runs, never which task runs. Turning it down makes the
        drafts plainer; it does not stop the inbox being swept or disable a check. The thing
        that pauses work is the spend cap, and that is separate.
      </p>
      {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
    </div>
  )
}
