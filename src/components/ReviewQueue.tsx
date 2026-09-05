'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import type { Draft, FieldProposal } from '@/lib/types'
import { relativeTime } from '@/lib/format'

interface Props {
  drafts: Draft[]
  proposals: FieldProposal[]
  dealNames: Record<string, string>
  canApprove: boolean
  focusDraftId?: string
}

type Undo = { label: string; run: () => Promise<void> } | null

/**
 * Liezel's home page. Two lists: drafts to approve, field-change proposals to accept.
 *
 * Optimised for a phone in one hand: 44px targets, swipe right to accept, left to
 * dismiss, and an undo toast on every action — because the fastest surface is the one
 * you are not afraid to tap.
 */
export function ReviewQueue({ drafts, proposals, dealNames, canApprove, focusDraftId }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'drafts' | 'proposals'>(
    proposals.length > 0 && drafts.length === 0 ? 'proposals' : 'drafts',
  )
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [undo, setUndo] = useState<Undo>(null)
  const [error, setError] = useState<string | null>(null)

  const hide = (id: string) => setHidden((s) => new Set(s).add(id))
  const unhide = (id: string) =>
    setHidden((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })

  async function act(url: string, body: unknown, id: string, label: string) {
    hide(id)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        unhide(id)
        setError(json.error ?? 'That did not go through.')
        return
      }
      setUndo({
        label,
        run: async () => {
          unhide(id)
          setUndo(null)
          router.refresh()
        },
      })
      setTimeout(() => setUndo(null), 6000)
      router.refresh()
    } catch {
      unhide(id)
      setError('Network error.')
    }
  }

  const visibleDrafts = drafts.filter((d) => !hidden.has(d.id))
  const visibleProposals = proposals.filter((p) => !hidden.has(p.id))

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={`pill ${tab === 'drafts' ? 'pill-accent' : 'pill-ghost'}`}
          onClick={() => setTab('drafts')}
        >
          Drafts <span className={tab === 'drafts' ? '' : 'pill-count'}>{visibleDrafts.length}</span>
        </button>
        <button
          type="button"
          className={`pill ${tab === 'proposals' ? 'pill-accent' : 'pill-ghost'}`}
          onClick={() => setTab('proposals')}
        >
          Changes <span className={tab === 'proposals' ? '' : 'pill-count'}>{visibleProposals.length}</span>
        </button>
      </div>

      {error ? (
        <div className="card mb-3 border-danger">
          <p className="body-copy text-danger">{error}</p>
        </div>
      ) : null}

      {tab === 'drafts' ? (
        visibleDrafts.length === 0 ? (
          <Empty
            title="No drafts waiting"
            body="The drafts engine writes proposals here — acknowledgements, follow-ups, forcing emails, welcome kits. Nothing reaches a client without someone pressing send."
          />
        ) : (
          <ul className="space-y-3">
            {visibleDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                dealName={draft.dealId ? dealNames[draft.dealId] : undefined}
                canApprove={canApprove}
                autoOpen={draft.id === focusDraftId}
                onApprove={(body, subject) =>
                  act(
                    `/api/drafts/${draft.id}`,
                    { action: 'approve', body, subject },
                    draft.id,
                    'Draft approved',
                  )
                }
                onDismiss={() =>
                  act(`/api/drafts/${draft.id}`, { action: 'dismiss' }, draft.id, 'Draft dismissed')
                }
              />
            ))}
          </ul>
        )
      ) : visibleProposals.length === 0 ? (
        <Empty
          title="No pending changes"
          body="When email intake finds a value that conflicts with what the record already says — a moved AV time, a changed fee — it lands here as old → new. Empty fields are filled silently and logged."
        />
      ) : (
        <ul className="space-y-3">
          {visibleProposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              dealName={dealNames[p.dealId]}
              canApprove={canApprove}
              onAccept={() =>
                act(`/api/proposals/${p.id}`, { action: 'accept' }, p.id, 'Change accepted')
              }
              onDismiss={() =>
                act(`/api/proposals/${p.id}`, { action: 'dismiss' }, p.id, 'Change dismissed')
              }
            />
          ))}
        </ul>
      )}

      {undo ? (
        <div className="fixed inset-x-0 bottom-20 z-40 mx-auto w-fit md:bottom-6">
          <div className="flex items-center gap-3 rounded-pill border bg-raised px-4 py-2">
            <span className="sub">{undo.label}</span>
            <button type="button" className="micro text-accent" onClick={() => void undo.run()}>
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="well px-5 py-10 text-center">
      <div className="rowname mb-2">{title}</div>
      <p className="body-copy mx-auto max-w-[46ch] text-ink-secondary">{body}</p>
    </div>
  )
}

/** Shared swipe handling: right = accept, left = dismiss. */
function useSwipe(onRight: () => void, onLeft: () => void) {
  const start = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)
  return {
    offset,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        start.current = e.touches[0]?.clientX ?? null
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (start.current === null) return
        setOffset((e.touches[0]?.clientX ?? 0) - start.current)
      },
      onTouchEnd: () => {
        if (offset > 90) onRight()
        else if (offset < -90) onLeft()
        setOffset(0)
        start.current = null
      },
    },
  }
}

function DraftCard({
  draft,
  dealName,
  canApprove,
  autoOpen,
  onApprove,
  onDismiss,
}: {
  draft: Draft
  dealName?: string
  canApprove: boolean
  autoOpen: boolean
  onApprove: (body: string, subject: string) => Promise<void>
  onDismiss: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(autoOpen)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const edited = subject !== draft.subject || body !== draft.body
  const { offset, handlers } = useSwipe(
    () => canApprove && void onApprove(body, subject),
    () => canApprove && void onDismiss(),
  )

  const verdict = draft.checkerVerdict

  return (
    <li
      className="card"
      style={{ transform: offset ? `translateX(${offset / 3}px)` : undefined }}
      {...handlers}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="micro">{draft.type}</span>
        <span className="sub">{relativeTime(draft.createdAt)}</span>
      </div>

      <button
        type="button"
        className="mt-2 block w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="rowname">{draft.subject || 'No subject'}</div>
        <div className="sub mt-1">
          {dealName ? `${dealName} · ` : ''}
          {draft.toEmail ?? 'no recipient'}
        </div>
      </button>

      {verdict && !verdict.ok ? (
        <div className="mt-3 border-l-2 border-warning pl-3">
          <div className="micro text-warning">Checker flagged</div>
          <ul className="body-copy mt-1 text-ink-secondary">
            {verdict.issues.map((issue) => (
              <li key={issue}>· {issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3">
          <div>
            <div className="micro mb-1">Subject</div>
            <input
              className="field-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!canApprove}
            />
          </div>
          <div>
            <div className="micro mb-1">Body</div>
            <textarea
              className="field-input body-copy min-h-[180px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!canApprove}
            />
          </div>
        </div>
      ) : (
        <p className="body-copy mt-3 line-clamp-3 text-ink-secondary">{draft.body}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pill pill-accent"
          onClick={() => void onApprove(body, subject)}
          disabled={!canApprove}
          title={canApprove ? undefined : 'Your role cannot approve sends.'}
        >
          {edited ? 'Save & approve' : 'Approve'}
        </button>
        <button
          type="button"
          className="pill pill-outline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Collapse' : 'Edit'}
        </button>
        <button
          type="button"
          className="pill pill-ghost"
          onClick={() => void onDismiss()}
          disabled={!canApprove}
        >
          Dismiss
        </button>
        {draft.dealId ? (
          <Link href={`/deals/${draft.dealId}`} className="sub ml-auto">
            open deal →
          </Link>
        ) : null}
      </div>
    </li>
  )
}

function ProposalCard({
  proposal,
  dealName,
  canApprove,
  onAccept,
  onDismiss,
}: {
  proposal: FieldProposal
  dealName?: string
  canApprove: boolean
  onAccept: () => Promise<void>
  onDismiss: () => Promise<void>
}) {
  const { offset, handlers } = useSwipe(
    () => canApprove && void onAccept(),
    () => canApprove && void onDismiss(),
  )

  return (
    <li
      className="card"
      style={{ transform: offset ? `translateX(${offset / 3}px)` : undefined }}
      {...handlers}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="micro">{proposal.fieldLabel}</span>
        <span className="sub">{relativeTime(proposal.createdAt)}</span>
      </div>

      <div className="mt-2 rowname">{dealName ?? 'Unlinked deal'}</div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="well px-3 py-2">
          <div className="micro mb-1">Now</div>
          <div className="body-copy">{proposal.oldValue ?? '∅ empty'}</div>
        </div>
        <span className="text-ink-muted" aria-hidden="true">
          →
        </span>
        <div className="well border-accent px-3 py-2">
          <div className="micro mb-1 text-accent">Proposed</div>
          <div className="body-copy">{proposal.newValue}</div>
        </div>
      </div>

      {proposal.confidence !== null ? (
        <div className="sub mt-2">confidence {Math.round(proposal.confidence * 100)}%</div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pill pill-accent"
          onClick={() => void onAccept()}
          disabled={!canApprove}
        >
          Accept
        </button>
        <button
          type="button"
          className="pill pill-ghost"
          onClick={() => void onDismiss()}
          disabled={!canApprove}
        >
          Dismiss
        </button>
        {proposal.sourceEmailId ? (
          <Link href={`/deals/${proposal.dealId}?tab=activity`} className="sub ml-auto">
            source email →
          </Link>
        ) : null}
      </div>
    </li>
  )
}
