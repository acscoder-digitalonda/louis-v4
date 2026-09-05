'use client'

import { useEffect, useState } from 'react'

type Pref = 'light' | 'dark' | 'system'

const NEXT: Record<Pref, Pref> = { system: 'light', light: 'dark', dark: 'system' }
const GLYPH: Record<Pref, string> = { system: '◐', light: '☀', dark: '☾' }

/**
 * Three states, not two. "System" removes the attribute entirely so the media query
 * in the token sheet decides — which is why `data-theme` is never set to "system".
 */
export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>('system')

  useEffect(() => {
    const stored = localStorage.getItem('louis.theme') as Pref | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') setPref(stored)
  }, [])

  const apply = (next: Pref) => {
    setPref(next)
    localStorage.setItem('louis.theme', next)
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', next)
  }

  return (
    <button
      type="button"
      className="pill pill-ghost"
      onClick={() => apply(NEXT[pref])}
      aria-label={`Theme: ${pref}. Switch to ${NEXT[pref]}.`}
      title={`Theme: ${pref}`}
    >
      <span aria-hidden="true">{GLYPH[pref]}</span>
    </button>
  )
}
