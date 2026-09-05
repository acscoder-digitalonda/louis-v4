'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AiSettings, ModelTier } from '@/lib/types'

const TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus']

const TIER_USE: Record<ModelTier, string> = {
  haiku: 'classify · dedupe · normalize · checker passes · QA sweep',
  sonnet: 'extraction · research briefs · draft writing',
  opus: 'high-value research · sensitive drafts · weekly pipeline review',
}

/**
 * Settings → AI. The backend switch is a setting, not a deploy: flipping it changes
 * which transport the workers use on their next run. The OpenRouter fields exist from
 * day one and are greyed until a key is present in the environment.
 */
export function AiSettingsForm({
  initial,
  hasOpenRouterKey,
}: {
  initial: AiSettings
  hasOpenRouterKey: boolean
}) {
  const router = useRouter()
  const [ai, setAi] = useState<AiSettings>(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai }),
      })
      const json = (await res.json()) as { error?: string }
      setMessage(res.ok ? 'Saved.' : (json.error ?? 'Could not save.'))
      if (res.ok) router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="micro mb-2">Backend</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`pill ${ai.backend === 'claude-code' ? 'pill-accent' : 'pill-ghost'}`}
            onClick={() => setAi({ ...ai, backend: 'claude-code' })}
          >
            Claude Code (local runner)
          </button>
          <button
            type="button"
            className={`pill ${ai.backend === 'openrouter' ? 'pill-accent' : 'pill-ghost'}`}
            onClick={() => setAi({ ...ai, backend: 'openrouter' })}
            disabled={!hasOpenRouterKey}
            title={hasOpenRouterKey ? undefined : 'Set OPENROUTER_API_KEY to enable.'}
          >
            OpenRouter
          </button>
        </div>
        <p className="body-copy mt-2 text-ink-secondary">
          {ai.backend === 'claude-code'
            ? 'Phase 0: workers shell out to the local Claude Code runner. Cost shows as an estimate — covered by the Max plan — so you learn the real burn rate before flipping.'
            : 'API-billed through OpenRouter: one key, one bill, and a second provider available for the fallback tier.'}
        </p>
        {!hasOpenRouterKey ? (
          <p className="body-copy mt-1 text-warning">
            OPENROUTER_API_KEY is not set in this environment, so the fallback tier has nothing to
            fall back to.
          </p>
        ) : null}
      </div>

      <div>
        <div className="micro mb-2">Tier map</div>
        <div className="space-y-2">
          {TIERS.map((tier) => (
            <div key={tier} className="well px-3 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="rowname">{tier}</span>
                <span className="sub">{TIER_USE[tier]}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="sub">primary</span>
                  <input
                    className="field-input mt-1"
                    value={ai.tierModels[tier]}
                    onChange={(e) =>
                      setAi({ ...ai, tierModels: { ...ai.tierModels, [tier]: e.target.value } })
                    }
                  />
                </label>
                <label className="block">
                  <span className="sub">fallback (OpenRouter id)</span>
                  <input
                    className="field-input mt-1"
                    value={ai.fallbackModels[tier]}
                    onChange={(e) =>
                      setAi({
                        ...ai,
                        fallbackModels: { ...ai.fallbackModels, [tier]: e.target.value },
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="micro">Monthly cap (USD)</span>
          <input
            className="field-input mt-1"
            type="number"
            min={0}
            value={ai.monthlyCapUsd}
            onChange={(e) => setAi({ ...ai, monthlyCapUsd: Number(e.target.value) })}
          />
        </label>
        <label className="mt-6 flex items-center gap-2">
          <input
            type="checkbox"
            checked={ai.pauseNonCriticalAtCap}
            onChange={(e) => setAi({ ...ai, pauseNonCriticalAtCap: e.target.checked })}
          />
          <span className="body-copy">
            At the cap, pause research and QA — intake and timers keep running
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="pill pill-accent" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message ? <span className="sub">{message}</span> : null}
      </div>
    </div>
  )
}
