/**
 * Paper-ink primitives.
 *
 * Two languages, never mixed (design notes): **statuses are LEDs**, **actions are pills**.
 * If a component here starts taking a colour prop with a hex in it, something has gone
 * wrong — colour arrives as a token name only.
 */

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { ContractStatus, PaymentStatus, StageKey } from '@/lib/types'
import { stageByKey } from '~/speaker.config'

export function Micro({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`micro ${className}`}>{children}</div>
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>
}

export function Well({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`well ${className}`}>{children}</div>
}

type PillVariant = 'ghost' | 'outline' | 'accent'

export function Pill({
  children,
  variant = 'ghost',
  className = '',
  href,
  onClick,
  disabled,
  title,
  type = 'button',
}: {
  children: ReactNode
  variant?: PillVariant
  className?: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  const cls = `pill pill-${variant} ${className}`
  if (href) {
    return (
      <Link href={href} className={cls} title={title}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

/**
 * LED status. `token` is a CSS custom-property name — the only way colour enters.
 * `on` lights the label as well as the dot; `hollow` is the idle state.
 */
export function Led({
  label,
  token,
  on = false,
  hollow = false,
  className = '',
}: {
  label: string
  token?: string
  on?: boolean
  hollow?: boolean
  className?: string
}) {
  const style = token ? ({ ['--led-color' as string]: `var(--${token})` } as React.CSSProperties) : undefined
  return (
    <span
      className={`led ${on ? 'led-on' : ''} ${hollow ? 'led-hollow' : ''} ${className}`}
      style={style}
    >
      {label}
    </span>
  )
}

const STAGE_TOKENS: Record<StageKey, string> = {
  inquiry: 'stage-inquiry',
  qualified: 'stage-qualified',
  'firm-offer': 'stage-firmoffer',
  'closed-won': 'stage-closedwon',
  'pre-event': 'stage-preevent',
  delivered: 'stage-delivered',
  debriefed: 'stage-debriefed',
  'closed-lost': 'stage-closedlost',
}

export function StageLed({ stage, className = '' }: { stage: StageKey; className?: string }) {
  return (
    <Led
      label={stageByKey.get(stage)?.label ?? stage}
      token={STAGE_TOKENS[stage]}
      on
      className={className}
    />
  )
}

const PAYMENT_TOKENS: Record<PaymentStatus, { token: string; on: boolean; hollow: boolean }> = {
  unbilled: { token: 'text-muted', on: false, hollow: true },
  invoiced: { token: 'chip-pending', on: true, hollow: false },
  partial: { token: 'chip-pending', on: true, hollow: false },
  paid: { token: 'chip-paid', on: true, hollow: false },
  overdue: { token: 'chip-overdue', on: true, hollow: false },
}

export function PaymentLed({ status }: { status: PaymentStatus }) {
  const cfg = PAYMENT_TOKENS[status]
  return <Led label={status} token={cfg.token} on={cfg.on} hollow={cfg.hollow} />
}

const CONTRACT_TOKENS: Record<ContractStatus, { label: string; token: string; on: boolean; hollow: boolean }> = {
  none: { label: 'no contract', token: 'text-muted', on: false, hollow: true },
  out: { label: 'contract out', token: 'chip-contract-out', on: true, hollow: false },
  signed: { label: 'contract signed', token: 'chip-contract-signed', on: true, hollow: false },
}

export function ContractLed({ status }: { status: ContractStatus }) {
  const cfg = CONTRACT_TOKENS[status]
  return <Led label={cfg.label} token={cfg.token} on={cfg.on} hollow={cfg.hollow} />
}

/** Empty states teach: what appears here, and which automation fills it. */
export function EmptyState({
  title,
  filledBy,
  action,
}: {
  title: string
  filledBy: string
  action?: ReactNode
}) {
  return (
    <div className="well px-5 py-8 text-center">
      <div className="rowname mb-2">{title}</div>
      <p className="body-copy mx-auto max-w-[42ch] text-ink-secondary">{filledBy}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <Micro>{children}</Micro>
      {right}
    </div>
  )
}

export function DateTile({ date }: { date: string | null }) {
  if (!date) {
    return (
      <div className="well flex h-[50px] w-[50px] flex-none flex-col items-center justify-center">
        <span className="text-[8px] tracking-[.18em] text-ink-muted">TBD</span>
      </div>
    )
  }
  const d = new Date(date)
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
  const dayNum = d.getUTCDate()
  return (
    <div className="well flex h-[50px] w-[50px] flex-none flex-col items-center justify-center">
      <span className="text-[8px] font-bold tracking-[.18em] text-ink-secondary">{month}</span>
      <span className="text-[17px] font-bold leading-none">{dayNum}</span>
    </div>
  )
}
