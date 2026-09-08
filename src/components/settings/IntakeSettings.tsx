import { Micro } from '@/components/ui'
import { queryFor, resolveAccounts, DEFAULT_LOOKBACK_DAYS } from '@/lib/intake/accounts'
import { WORKERS } from '@/workers'
import type { MailAccount } from '@/lib/types'

/**
 * Settings → Intake (WP2.3 / WP1.6).
 *
 * Read-only, and for the same reason the rate card screen is: the accounts are rows in
 * Airtable, and a second place to edit them is how two answers to "which mailboxes do we
 * read" start disagreeing.
 *
 * What it does add is the thing the table cannot show — **the query each account actually
 * produces**. "Watched label" and "Full mailbox" are two words that decide whether Louis
 * reads a filed thread or every message a person receives, and the difference deserves to
 * be visible as the search string it becomes.
 */
export function IntakeSettings({ accounts }: { accounts: MailAccount[] }) {
  const resolved = resolveAccounts(accounts, {
    addresses: process.env.GMAIL_ADDRESSES,
    label: process.env.GMAIL_LABEL,
  })
  const fromEnv = accounts.filter((a) => a.active).length === 0 && resolved.length > 0
  const sweep = WORKERS['f2-email-intake']

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <Micro>Sweep</Micro>
        <p className="body-copy mt-1">
          Runs on <code>{sweep?.schedule}</code>. Each run asks Gmail first and returns before
          touching Airtable when there is no new mail, so a quiet window costs nothing.
        </p>
      </div>

      {resolved.length === 0 ? (
        <div className="card border-warning">
          <Micro>No mailboxes</Micro>
          <p className="body-copy mt-1">
            Nothing is configured, so the intake sweep reads nothing and returns. Add rows to
            the Mail Accounts table in Airtable.
          </p>
        </div>
      ) : (
        <div className="card">
          <Micro>
            Mailboxes · {resolved.length}
            {fromEnv ? ' · from the environment' : ''}
          </Micro>
          {fromEnv ? (
            <p className="body-copy mt-1 text-ink-secondary">
              The Mail Accounts table is empty, so these come from <code>GMAIL_ADDRESSES</code>.
              The fallback is watched-label only: an install nobody has configured should not be
              reading every message in somebody&rsquo;s mailbox.
            </p>
          ) : null}

          <ul className="mt-3 divide-y">
            {resolved.map((a, i) => (
              <li key={a.address} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="rowname">{a.label}</span>
                  <span className="sub">
                    {a.scope === 'full' ? 'Full mailbox' : `Label: ${a.watchedLabel}`} ·{' '}
                    {a.lookbackDays}d lookback
                    {i === 0 ? ' · first copy wins' : ''}
                  </span>
                </div>
                <div className="sub">{a.address}</div>
                <code className="mt-2 block break-all text-[12px] opacity-70">{queryFor(a)}</code>
              </li>
            ))}
          </ul>

          <p className="sub mt-3">
            Chat, spam and trash are excluded everywhere. A sweep that reads spam eventually
            classifies a phishing mail as an inquiry and puts a fake company in the pipeline.
          </p>
        </div>
      )}

      <div className="card">
        <Micro>How a message is recognised</Micro>
        <p className="body-copy mt-1">
          By its <code>Message-ID</code>, not its Gmail id. Gmail ids are per mailbox, so the
          same email in two inboxes has two of them — deduping on those would make two records
          of one email, two classifications, and eventually two deals for one inquiry.
        </p>
        <p className="body-copy mt-2 text-ink-secondary">
          Lookback defaults to {DEFAULT_LOOKBACK_DAYS} days and is a per-account column. A
          historical backfill uses an absolute date instead, which is a separate run rather
          than a setting somebody leaves turned up.
        </p>
      </div>
    </div>
  )
}
