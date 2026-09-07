'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Micro } from '@/components/ui'
import { checkVoice, summarise } from '@/lib/voice'
import { missingPlaceholders, render, type Template } from '@/lib/templates'

interface Props {
  templates: Template[]
  /** The variables a draft can actually fill, taken from a real deal. */
  sample: Record<string, string>
  sampleDealName: string | null
  canEdit: boolean
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

/**
 * Settings → Templates (WP2.3).
 *
 * Four things at once, because they are the same question asked four ways: what does this
 * say, will its variables resolve, does it sound like us, and what will the client
 * actually see.
 *
 * The preview renders against a **real deal**, not a fixture. A template that looks fine
 * with `{{eventName}}` and falls apart with "YPO Rocky Mountain — Annual Chapter Retreat
 * (2026)" is a template nobody has really read.
 */
export function TemplateEditor({ templates, sample, sampleDealName, canEdit }: Props) {
  const router = useRouter()
  const [activeKey, setActiveKey] = useState(templates[0]?.key ?? '')
  const [subject, setSubject] = useState(templates[0]?.subject ?? '')
  const [body, setBody] = useState(templates[0]?.body ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = templates.find((t) => t.key === activeKey)
  const dirty = Boolean(active) && (subject !== active!.subject || body !== active!.body)

  function select(t: Template) {
    if (dirty && !window.confirm('Discard the unsaved change?')) return
    setActiveKey(t.key)
    setSubject(t.subject)
    setBody(t.body)
    setSaved(false)
    setError(null)
  }

  // Which variables this copy uses, and which of them nothing can fill.
  const { used, unknown } = useMemo(() => {
    const names = [...`${subject}\n${body}`.matchAll(PLACEHOLDER)].map((m) => m[1]!)
    const set = [...new Set(names)]
    return { used: set, unknown: set.filter((n) => !(n in sample)) }
  }, [subject, body, sample])

  const preview = useMemo(
    () => ({ subject: render(subject, sample), body: render(body, sample) }),
    [subject, body, sample],
  )
  // What is still unfilled after rendering against a real deal: either an unknown
  // variable, or a known one this particular deal has nothing for.
  const unresolved = missingPlaceholders(`${preview.subject}\n${preview.body}`)
  const voice = useMemo(() => checkVoice(subject, body), [subject, body])
  const mustFix = voice.filter((v) => v.severity === 'must')

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: activeKey, subject, body }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not save.')
        return
      }
      setSaved(true)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="card max-h-[70vh] overflow-y-auto p-2">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => select(t)}
            className={`block w-full rounded px-3 py-2 text-left ${
              t.key === activeKey ? 'bg-raised' : ''
            }`}
          >
            <div className="rowname truncate">{t.label}</div>
            <div className="sub truncate">{t.key}</div>
          </button>
        ))}
      </div>

      {active ? (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Micro>{active.key}</Micro>
              <div className="flex items-center gap-2">
                {saved && !dirty ? <span className="sub">saved</span> : null}
                <button
                  type="button"
                  className="pill pill-accent"
                  disabled={!canEdit || !dirty || saving}
                  onClick={() => void save()}
                >
                  {saving ? 'saving…' : 'Save'}
                </button>
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <Micro>Subject</Micro>
              <input
                className="field-input"
                value={subject}
                readOnly={!canEdit}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>

            <label className="mt-3 flex flex-col gap-1">
              <Micro>Body</Micro>
              <textarea
                className="field-input min-h-[220px] font-mono text-[13px]"
                value={body}
                readOnly={!canEdit}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>

            {!canEdit ? (
              <p className="body-copy mt-2 text-ink-secondary">
                Your role can read templates but not edit them.
              </p>
            ) : null}
            {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="card">
              <Micro>Variables · {used.length}</Micro>
              <div className="mt-2 flex flex-wrap gap-1">
                {used.map((v) => (
                  <span
                    key={v}
                    className={`pill ${unknown.includes(v) ? 'pill-danger' : 'pill-ghost'}`}
                    title={unknown.includes(v) ? 'Nothing can fill this' : sample[v] || 'empty on this deal'}
                  >
                    {v}
                  </span>
                ))}
                {used.length === 0 ? <span className="sub">none</span> : null}
              </div>
              {unknown.length > 0 ? (
                <p className="body-copy mt-2 text-danger">
                  {unknown.join(', ')} {unknown.length === 1 ? 'is' : 'are'} not a variable the
                  drafts engine knows. It will reach the client as written.
                </p>
              ) : null}
            </div>

            <div className="card">
              <Micro>Voice{mustFix.length > 0 ? ` · ${mustFix.length} to fix` : ''}</Micro>
              <pre className="body-copy mt-2 whitespace-pre-wrap font-sans">
                {summarise(voice)}
              </pre>
              <p className="sub mt-2">Advisory. Nothing here blocks a save.</p>
            </div>
          </div>

          <div className="card">
            <Micro>
              Preview{sampleDealName ? ` · ${sampleDealName}` : ' · no deal to render against'}
            </Micro>
            <div className="well mt-2 p-4">
              <div className="rowname">{preview.subject}</div>
              <pre className="body-copy mt-3 whitespace-pre-wrap font-sans">{preview.body}</pre>
            </div>
            {unresolved.length > 0 ? (
              <p className="body-copy mt-2 text-warning">
                Still unfilled on this deal: {unresolved.join(', ')}. A draft would go to the queue
                with the gap visible rather than blanked out.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="body-copy">No templates loaded.</p>
        </div>
      )}
    </div>
  )
}
