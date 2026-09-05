'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ALL_TOKENS,
  EDITABLE_TOKENS,
  TOKEN_GROUPS,
  contrastRatio,
  isSafeColor,
  type ThemeName,
} from '@/lib/theme'
import type { ThemeSettings } from '@/lib/types'

/**
 * Accent editor (Handoff §2.1).
 *
 * A hex input per non-background token, per theme, with live preview: the value is
 * written straight onto the document element so you see it before you save. The
 * contrast guard warns below 4.5:1 and lets you save anyway with a badge — friendly,
 * not blocking.
 */
export function AccentEditor({ initial }: { initial: ThemeSettings }) {
  const router = useRouter()
  const [theme, setTheme] = useState<ThemeName>('light')
  const [values, setValues] = useState<ThemeSettings>({
    light: { ...initial.light },
    dark: { ...initial.dark },
  })
  const [sameForBoth, setSameForBoth] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const defaults = useMemo(
    () => Object.fromEntries(ALL_TOKENS.map((t) => [t.name, { light: t.light, dark: t.dark }])),
    [],
  )

  const effective = (name: string) =>
    values[theme][name] ?? defaults[name]?.[theme] ?? ''

  function setToken(name: string, value: string) {
    setValues((prev) => {
      const next: ThemeSettings = { light: { ...prev.light }, dark: { ...prev.dark } }
      next[theme][name] = value
      if (sameForBoth) next[theme === 'light' ? 'dark' : 'light'][name] = value
      return next
    })
    if (isSafeColor(value)) {
      // Live preview — the point of a hex editor is seeing it, not imagining it.
      document.documentElement.style.setProperty(`--${name}`, value)
    }
  }

  function reset(name: string) {
    setValues((prev) => {
      const next: ThemeSettings = { light: { ...prev.light }, dark: { ...prev.dark } }
      delete next.light[name]
      delete next.dark[name]
      return next
    })
    document.documentElement.style.removeProperty(`--${name}`)
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: values }),
      })
      const json = (await res.json()) as { error?: string }
      setMessage(res.ok ? 'Saved.' : (json.error ?? 'Could not save.'))
      if (res.ok) router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const bgFor = (on: string | undefined) => {
    const key = on === 'bg-raised' ? 'bg-raised' : on === 'bg-sunken' ? 'bg-sunken' : on === 'accent' ? 'accent' : 'bg'
    return values[theme][key] ?? defaults[key]?.[theme] ?? ''
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`pill ${theme === 'light' ? 'pill-accent' : 'pill-ghost'}`}
          onClick={() => setTheme('light')}
        >
          Light
        </button>
        <button
          type="button"
          className={`pill ${theme === 'dark' ? 'pill-accent' : 'pill-ghost'}`}
          onClick={() => setTheme('dark')}
        >
          Dark
        </button>
        <label className="sub ml-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={sameForBoth}
            onChange={(e) => setSameForBoth(e.target.checked)}
          />
          use same for both
        </label>
        <button type="button" className="pill pill-accent ml-auto" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {message ? <p className="body-copy mb-3 text-ink-secondary">{message}</p> : null}

      {TOKEN_GROUPS.map((group) => {
        const tokens = EDITABLE_TOKENS.filter((t) => t.group === group)
        if (tokens.length === 0) return null
        return (
          <div key={group} className="mb-5">
            <div className="micro mb-2">{group}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {tokens.map((token) => {
                const value = effective(token.name)
                const ratio = token.on ? contrastRatio(value, bgFor(token.on)) : null
                const low = ratio !== null && ratio < 4.5
                const overridden = values[theme][token.name] !== undefined
                return (
                  <div key={token.name} className="well flex items-center gap-3 px-3 py-2">
                    <span
                      className="h-6 w-6 flex-none rounded border"
                      style={{ background: value }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="rowname truncate">{token.label}</div>
                      <div className="sub truncate">--{token.name}</div>
                    </div>
                    <input
                      className="field-input w-[104px] text-[11px]"
                      value={value}
                      onChange={(e) => setToken(token.name, e.target.value)}
                      aria-label={`${token.label} colour`}
                      spellCheck={false}
                    />
                    {low ? (
                      <span className="sub text-warning" title={`Contrast ${ratio?.toFixed(2)}:1 — below 4.5:1`}>
                        ⚠
                      </span>
                    ) : null}
                    {overridden ? (
                      <button type="button" className="sub" onClick={() => reset(token.name)} title="Reset to default">
                        ↺
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
