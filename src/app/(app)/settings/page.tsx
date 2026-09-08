import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canViewScreen, canWrite } from '@/lib/rbac'
import { Card, EmptyState, Led, Micro, SectionTitle } from '@/components/ui'
import { AccentEditor } from '@/components/settings/AccentEditor'
import { AiSettingsForm } from '@/components/settings/AiSettingsForm'
import { UsageMeter } from '@/components/settings/UsageMeter'
import { UserRow } from '@/components/settings/UserRow'
import { TokenList } from '@/components/settings/TokenList'
import { TemplateEditor } from '@/components/settings/TemplateEditor'
import { RateCardTable } from '@/components/settings/RateCardTable'
import { ModeDial } from '@/components/settings/ModeDial'
import { NotificationMatrix } from '@/components/settings/NotificationMatrix'
import { IntakeSettings } from '@/components/settings/IntakeSettings'
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@/lib/quiet-hours'
import { isMode } from '@/lib/gateway/modes'
import { loadTemplates } from '@/lib/templates'
import { templateValues } from '@/workers/f7-drafts'
import { relativeTime } from '@/lib/format'
import { generatedMeta } from '@/lib/airtable/fields'
import { speaker } from '~/speaker.config'
import { transport } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

const TABS = ['appearance', 'templates', 'pricing', 'users', 'notifications', 'intake', 'ai', 'mcp', 'mirror', 'data'] as const
type Tab = (typeof TABS)[number]

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'appearance'

  const user = await requireUser()
  if (!canViewScreen(user.role, 'settings')) redirect('/pipeline')

  const provider = db()
  const [settings, users, usage, mirror, tokens] = await Promise.all([
    provider.getSettings(),
    provider.listUsers(),
    provider.listUsage(new Date(Date.now() - 31 * 86_400_000).toISOString()),
    provider.listMirrorState(),
    provider.listApiTokens().catch(() => []),
  ])

  // Loaded only for the tabs that need them, because each is an Airtable read and this
  // page is opened often.
  const templates = tab === 'templates' ? await loadTemplates() : []
  const rateCards = tab === 'pricing' ? await provider.listRateCards().catch(() => []) : []

  // The preview renders against a real deal. A template that reads fine with
  // `{{eventName}}` and falls apart with a real one is a template nobody has read.
  const sampleDeal =
    tab === 'templates'
      ? (await provider.listDeals()).find((d) => !d.historical) ??
        (await provider.listDeals())[0] ??
        null
      : null
  const sample = sampleDeal ? await templateValues(sampleDeal) : {}

  return (
    <div>
      <SectionTitle>Settings</SectionTitle>

      <nav className="scroll-x no-scrollbar -mx-[var(--shell-pad)] mb-5 flex gap-2 px-[var(--shell-pad)]">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/settings?tab=${t}`}
            className={`pill ${t === tab ? 'pill-accent' : 'pill-ghost'}`}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === 'appearance' ? (
        <Card>
          <SectionTitle>Appearance</SectionTitle>
          <p className="body-copy mb-4 text-ink-secondary">
            Paper-ink is the default light theme; dark is derived from the same token map. Every
            colour below is a CSS variable — components hold no hex at all.
          </p>
          <AccentEditor initial={settings.theme} />
        </Card>
      ) : null}

      {tab === 'users' ? (
        <Card>
          <SectionTitle right={<span className="sub">{users.length} users</span>}>
            Users & roles
          </SectionTitle>
          <p className="body-copy mb-4 text-ink-secondary">
            Google SSO is the only sign-in. This list is the allowlist — and it is a plain Airtable
            table, so if app auth ever misbehaves an admin fixes it in the base.
          </p>
          <ul>
            {users.map((u) => (
              <UserRow key={u.id} user={u} canEdit={user.role === 'admin'} />
            ))}
          </ul>
          <p className="body-copy mt-4 text-ink-secondary">
            Seed admins from speaker.config: {speaker.seedAdmins.join(', ')} — two, so a single
            locked-out Google account never strands admin access.
          </p>
        </Card>
      ) : null}

      {tab === 'ai' ? (
        <div className="space-y-4">
          <Card>
            <SectionTitle>AI backend</SectionTitle>
            <ModeDial
              current={isMode(settings.ai.mode) ? settings.ai.mode : 'steady'}
              canEdit={canWrite(user.role, 'settings').allowed}
            />
            <AiSettingsForm
              initial={settings.ai}
              hasOpenRouterKey={Boolean(process.env.OPENROUTER_API_KEY)}
            />
          </Card>
          <Card>
            <SectionTitle>Usage meter</SectionTitle>
            <UsageMeter rows={usage} ai={settings.ai} />
          </Card>
        </div>
      ) : null}

      {tab === 'intake' ? (
        <IntakeSettings accounts={await provider.listMailAccounts().catch(() => [])} />
      ) : null}

      {tab === 'notifications' ? (
        <NotificationMatrix
          users={users.filter((u) => u.active !== false)}
          quietHours={{
            ...DEFAULT_QUIET_HOURS,
            timezone: speaker.timezone,
            ...((settings as unknown as { quietHours?: Partial<QuietHours> }).quietHours ?? {}),
          }}
          canEdit={canWrite(user.role, 'settings').allowed}
        />
      ) : null}

      {tab === 'templates' ? (
        <TemplateEditor
          templates={templates}
          sample={sample}
          sampleDealName={sampleDeal?.name ?? null}
          canEdit={canWrite(user.role, 'templates').allowed}
        />
      ) : null}

      {tab === 'pricing' ? (
        <RateCardTable cards={rateCards} />
      ) : null}

      {tab === 'mcp' ? (
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <Micro>The endpoint</Micro>
            <p className="body-copy mt-1">
              <code>{`${process.env.NEXTAUTH_URL ?? ''}/api/mcp`}</code>
            </p>
            <p className="body-copy mt-2">
              Add it in Claude as a custom connector with the token as a bearer header. Reads are
              safe; writes are audited as you, tagged <code>via MCP</code>, and reversible as a
              batch. No tool can write money.
            </p>
          </Card>
          <TokenList
            tokens={tokens}
            admins={users.filter((u) => u.role === 'admin')}
            currentUserEmail={user.email}
          />
        </div>
      ) : null}

      {tab === 'mirror' ? (
        <div className="space-y-4">
          <Card>
            <SectionTitle>System status</SectionTitle>
            <ul className="space-y-2">
              <StatusRow
                label="Data backend"
                value={provider.kind === 'airtable' ? 'Airtable (live)' : 'Mock (no credentials)'}
                ok={provider.kind === 'airtable'}
              />
              <StatusRow
                label="Field IDs"
                value={
                  generatedMeta.generatedAt
                    ? `generated ${relativeTime(generatedMeta.generatedAt)}`
                    : 'not generated — bound by field name'
                }
                ok={Boolean(generatedMeta.generatedAt)}
              />
              <StatusRow
                label="Mail transport"
                value={transport() === 'gmail' ? 'Gmail service address' : 'console (dev)'}
                ok={transport() === 'gmail'}
              />
            </ul>
            <p className="body-copy mt-4 text-ink-secondary">
              If this app is down, everything still works: all state lives in Airtable and the
              workers talk to Airtable, not to this front-end. The published Airtable interface is
              the fallback surface.
            </p>
            {process.env.AIRTABLE_FALLBACK_INTERFACE_URL ? (
              <div className="mt-3">
                <a className="pill pill-outline" href={process.env.AIRTABLE_FALLBACK_INTERFACE_URL}>
                  Open the Airtable fallback
                </a>
              </div>
            ) : null}
          </Card>

          <Card>
            <SectionTitle>Mirror state</SectionTitle>
            {mirror.length === 0 ? (
              <EmptyState
                title="Nothing mirrored yet"
                filledBy="The mirror worker (F9) pushes calendar holds, per-deal Docs, the Sheets index and the Drive folder tree, then records the result here."
              />
            ) : (
              <ul>
                {mirror.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-3 border-b py-2 last:border-b-0">
                    <span className="rowname w-[80px]">{m.surface}</span>
                    <span className="sub min-w-0 flex-1 truncate">{m.entity}</span>
                    <span className="sub">{relativeTime(m.lastPushed)}</span>
                    <Led
                      label={m.ok ? 'ok' : 'error'}
                      token={m.ok ? 'chip-paid' : 'chip-overdue'}
                      on
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'data' ? (
        <div className="space-y-4">
          <Card>
            <SectionTitle>Export</SectionTitle>
            <p className="body-copy mb-4 text-ink-secondary">
              Everything is extractable at all times — the platform-exit guarantee. The HubSpot
              profile is the portable shape: Attio, Pipedrive and Salesforce importers accept it
              with minimal remapping, and every file carries an Airtable Record ID so exports
              round-trip.
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="pill pill-outline" href="/api/export?profile=native&table=deals">
                Deals (native CSV)
              </a>
              <a className="pill pill-outline" href="/api/export?profile=native&table=journalOrders">
                Journal orders
              </a>
              <a className="pill pill-accent" href="/api/export?profile=hubspot&table=deals">
                deals.csv (HubSpot)
              </a>
              <a className="pill pill-outline" href="/api/export?profile=hubspot&table=companies">
                companies.csv
              </a>
              <a className="pill pill-outline" href="/api/export?profile=hubspot&table=contacts">
                contacts.csv
              </a>
            </div>
          </Card>

          <Card>
            <SectionTitle>Import</SectionTitle>
            <p className="body-copy text-ink-secondary">
              The importer accepts a raw HubSpot export natively — the mapping is stored two-way.
              Upload runs a dry-run diff first: Haiku normalises dates and names, flags dedupe
              candidates by email, phone and company+date, and a human approves the merge report
              before a single record is written.
            </p>
            <div className="mt-3">
              <span className="pill pill-ghost">CLI: npm run worker f11-import -- &lt;file.csv&gt;</span>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2">
      <Micro>{label}</Micro>
      <span className="flex items-center gap-3">
        <span className="body-copy text-ink-secondary">{value}</span>
        <Led label={ok ? 'ok' : 'check'} token={ok ? 'chip-paid' : 'chip-pending'} on />
      </span>
    </li>
  )
}
