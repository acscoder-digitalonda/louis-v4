'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { money, shortDate } from '@/lib/format'

export type FieldKind = 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'checkbox' | 'select'

export interface EditableFieldProps {
  endpoint: string
  field: string
  label: string
  value: string | number | boolean | null
  kind?: FieldKind
  options?: { value: string; label: string }[]
  readOnly?: boolean
  /** Shown on hover when read-only — teach, don't frustrate. */
  lockReason?: string
  placeholder?: string
  /** Airtable's Last Modified at read time; a stale write is rejected, not merged. */
  lastModified?: string | null
}

/**
 * Click-to-edit. Reading view and editing view are the same view.
 *
 * Optimistic: the new value paints immediately and rolls back with a toast if the
 * route refuses. Role-gating is enforced server-side — `readOnly` only decides whether
 * we bother rendering an input.
 */
export function EditableField(props: EditableFieldProps) {
  const {
    endpoint,
    field,
    label,
    value,
    kind = 'text',
    options = [],
    readOnly = false,
    lockReason,
    placeholder = 'Empty',
    lastModified,
  } = props

  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(value)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)

  useEffect(() => setLocal(value), [value])
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function save(next: string | number | boolean | null) {
    if (next === value) {
      setEditing(false)
      return
    }
    const previous = value
    setLocal(next)
    setEditing(false)
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { [field]: next }, lastModified: lastModified ?? null }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setLocal(previous)
        setToast(json.error ?? 'Could not save.')
        return
      }
      router.refresh()
    } catch {
      setLocal(previous)
      setToast('Network error — the change was not saved.')
    } finally {
      setSaving(false)
    }
  }

  const display = () => {
    if (kind === 'checkbox') return local ? 'Yes' : 'No'
    if (local === null || local === '' || local === undefined) return placeholder
    if (kind === 'select') {
      return options.find((o) => o.value === local)?.label ?? String(local)
    }
    // A date is a calendar day, so it reads as one — the ISO value stays in the input.
    if (kind === 'date') return shortDate(String(local))
    if (kind === 'currency') return money(Number(local))
    return String(local)
  }

  const isEmpty = local === null || local === '' || local === undefined

  if (readOnly) {
    return (
      <div>
        <div className="micro mb-1">{label}</div>
        <div
          className="locked text-[12px] text-ink-secondary"
          title={lockReason ?? 'Read-only — this value is owned elsewhere.'}
        >
          {display()}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="micro mb-1">{label}</div>

      {kind === 'checkbox' ? (
        <button
          type="button"
          className={`pill ${local ? 'pill-accent' : 'pill-outline'}`}
          onClick={() => void save(!local)}
          disabled={saving}
        >
          {local ? 'Yes' : 'No'}
        </button>
      ) : editing ? (
        kind === 'textarea' ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="field-input body-copy min-h-[92px]"
            defaultValue={local === null ? '' : String(local)}
            onBlur={(e) => void save(e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                void save((e.target as HTMLTextAreaElement).value || null)
              }
            }}
          />
        ) : kind === 'select' ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            className="field-input"
            defaultValue={local === null ? '' : String(local)}
            onBlur={() => setEditing(false)}
            onChange={(e) => void save(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="field-input"
            type={kind === 'date' ? 'date' : kind === 'number' || kind === 'currency' ? 'number' : 'text'}
            defaultValue={local === null ? '' : String(local)}
            onBlur={(e) => {
              const raw = e.target.value
              const next =
                raw === ''
                  ? null
                  : kind === 'number' || kind === 'currency'
                    ? Number(raw)
                    : raw
              void save(next)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        )
      ) : (
        <button
          type="button"
          className={`editable block w-full text-left text-[12px] ${
            isEmpty ? 'text-ink-muted' : ''
          } ${kind === 'textarea' ? 'body-copy whitespace-pre-wrap' : ''}`}
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
        >
          {display()}
        </button>
      )}

      {toast ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="body-copy text-danger">{toast}</span>
          <button type="button" className="sub" onClick={() => setToast(null)}>
            dismiss
          </button>
        </div>
      ) : null}
    </div>
  )
}
