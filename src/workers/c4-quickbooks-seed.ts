/**
 * C4 — QUICKBOOKS SEED. Phase C of the go-live cutover.
 *
 * Reads invoices and payments from QuickBooks and proposes Payment rows against the deals
 * and proposals already in the queue. The runbook is unambiguous about the boundary:
 *
 *   "Liezel confirms each payment; nothing is marked Paid by a machine."
 *
 * So every Payment this creates carries `status: 'proposed'`. The `Confirmed` status is
 * reachable only through the app, by a person, and this worker has no code that sets it.
 *
 * ── What "connected" turned out to mean ────────────────────────────────────
 *
 * There is an existing `workers/quickbooks-mirror` with a valid OAuth app, and its
 * read-only discipline is real. Two things stop it being C4:
 *
 *   - it writes to the **Cash** base, a different product
 *   - it runs against `QB_ENV=sandbox` — Intuit's test company, not Ben's books
 *
 * The second is the one that matters. Everything below works, and running it against
 * sandbox produces sandbox figures. Pointing it at the real company needs a fresh
 * authorisation through Intuit's consent screen, which is a person clicking Allow while
 * signed in to the real QuickBooks account. No amount of code substitutes for that.
 */

import { db } from '@/lib/data'
import { agentActor, recordEvent } from '@/lib/audit'
import {
  qboEnv,
  recentInvoices,
  recentPayments,
  type QboInvoice,
  type QboPayment,
  type QboToken,
} from '@/lib/quickbooks'
import type { DealProposal, Deal } from '@/lib/types'

const WORKER = 'C4'
export const DEFAULT_BATCH_ID = 'seed-quickbooks-2026-09'

/** Same normalisation the history import and the sheet seed use. */
function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|the|corp|corporation|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface QboMatch {
  invoice: QboInvoice
  /** Payments QuickBooks has linked to this invoice. */
  payments: QboPayment[]
  dealId: string | null
  proposalId: string | null
  matchedName: string | null
  reason: string
}

export interface QboPlan {
  env: 'sandbox' | 'production'
  invoices: number
  payments: number
  matched: QboMatch[]
  unmatched: QboInvoice[]
  alreadyRecorded: number
}

/**
 * Matches a QuickBooks customer to a deal or a proposal by name.
 *
 * Deliberately name-only, and deliberately conservative about it: a customer name in
 * QuickBooks is typed by whoever raised the invoice, so an exact normalised match is
 * evidence and anything looser is a guess. An invoice that cannot be placed is listed
 * rather than attached to the nearest thing, because attaching money to the wrong deal is
 * the one error here nobody would catch by reading the queue.
 */
export async function planQuickbooks(token: QboToken): Promise<QboPlan> {
  const provider = db()
  const [invoices, payments, deals, proposals, existing] = await Promise.all([
    recentInvoices(token),
    recentPayments(token),
    provider.listDeals(),
    provider.listDealProposals('proposed'),
    provider.listPayments(),
  ])

  const byDeal = new Map<string, Deal>()
  for (const d of deals) {
    const k = key(d.client?.name ?? d.name)
    if (k && !byDeal.has(k)) byDeal.set(k, d)
  }
  const byProposal = new Map<string, DealProposal>()
  for (const p of proposals) {
    const k = key(p.clientName ?? p.title)
    if (k && !byProposal.has(k)) byProposal.set(k, p)
  }

  // Invoice numbers already in Payments — a re-run must not duplicate them.
  const seen = new Set(existing.map((p) => p.invoiceNumber).filter(Boolean))

  const paymentsByInvoice = new Map<string, QboPayment[]>()
  for (const p of payments) {
    for (const line of p.Line ?? []) {
      for (const link of line.LinkedTxn ?? []) {
        if (link.TxnType !== 'Invoice' || !link.TxnId) continue
        paymentsByInvoice.set(link.TxnId, [...(paymentsByInvoice.get(link.TxnId) ?? []), p])
      }
    }
  }

  const plan: QboPlan = {
    env: qboEnv(),
    invoices: invoices.length,
    payments: payments.length,
    matched: [],
    unmatched: [],
    alreadyRecorded: 0,
  }

  for (const inv of invoices) {
    const number = inv.DocNumber ?? inv.Id
    if (seen.has(number)) {
      plan.alreadyRecorded += 1
      continue
    }

    const customer = inv.CustomerRef?.name ?? ''
    const k = key(customer)
    const deal = k ? byDeal.get(k) : undefined
    const proposal = k ? byProposal.get(k) : undefined

    if (!deal && !proposal) {
      plan.unmatched.push(inv)
      continue
    }

    plan.matched.push({
      invoice: inv,
      payments: paymentsByInvoice.get(inv.Id) ?? [],
      dealId: deal?.id ?? null,
      proposalId: proposal?.id ?? null,
      matchedName: deal?.client?.name ?? proposal?.clientName ?? null,
      reason: deal
        ? `QuickBooks customer "${customer}" matches deal ${deal.name}.`
        : `QuickBooks customer "${customer}" matches proposal ${proposal!.title}. No deal exists yet.`,
    })
  }

  return plan
}

export interface QboResult {
  created: number
  skippedNoDeal: number
  skippedNoAmount: number
}

/**
 * Writes Payment rows, always as proposals.
 *
 * A Payment can only link to a *Deal*, and most of the pipeline is still proposals, so an
 * invoice matching a proposal has nowhere to attach yet. Those are counted and reported
 * rather than forced somewhere — re-run C4 after the reconciliation session and they land.
 */
export async function commitQuickbooks(
  plan: QboPlan,
  batchId = DEFAULT_BATCH_ID,
): Promise<QboResult> {
  const provider = db()
  const out: QboResult = { created: 0, skippedNoDeal: 0, skippedNoAmount: 0 }

  for (const m of plan.matched) {
    if (!m.dealId) {
      out.skippedNoDeal += 1
      continue
    }

    // A payment row with no amount says nothing and cannot be confirmed. Defaulting it
    // to zero would put a number in a money field that no invoice ever contained.
    const amount = m.invoice.TotalAmt
    if (typeof amount !== 'number') {
      out.skippedNoAmount += 1
      continue
    }

    const paid = m.payments.reduce((sum, p) => sum + (p.TotalAmt ?? 0), 0)
    const created = await provider.createPayment({
      dealId: m.dealId,
      invoiceNumber: m.invoice.DocNumber ?? m.invoice.Id,
      amount,
      // Never Confirmed. A person does that in the app, per the runbook.
      status: 'proposed',
      method: m.payments.length > 0 ? 'QuickBooks payment' : null,
      receivedDate: m.payments[0]?.TxnDate ?? null,
      confirmedBy: null,
      note: [
        m.reason,
        `Invoice ${m.invoice.TxnDate ?? '?'}, total ${m.invoice.TotalAmt ?? '?'}, balance ${m.invoice.Balance ?? '?'}.`,
        m.payments.length > 0
          ? `${m.payments.length} payment(s) recorded in QuickBooks totalling ${paid}.`
          : 'No payment recorded against it in QuickBooks.',
        plan.env === 'sandbox' ? 'READ FROM THE INTUIT SANDBOX — not real money.' : null,
      ]
        .filter(Boolean)
        .join('\n'),
    })

    await recordEvent({
      table: 'payments',
      recordId: created.id,
      what: 'Proposed from QuickBooks',
      detail: `invoice ${m.invoice.Id} (${plan.env})`,
      actor: agentActor(WORKER),
      source: 'quickbooks',
      batchId,
    })
    out.created += 1
  }

  console.info(
    `[${WORKER}] quickbooks seed ${batchId}: ${out.created} payment proposal(s), ` +
      `${out.skippedNoDeal} waiting for their deal to be accepted, ` +
      `${out.skippedNoAmount} with no invoice amount`,
  )
  return out
}
