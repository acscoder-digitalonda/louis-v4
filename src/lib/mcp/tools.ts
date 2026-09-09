/**
 * WP3.4 — the tools the MCP endpoint exposes.
 *
 * The list is Jordan's, from doc 4 §3, and so are the constraints: read tools plus a
 * handful of audited admin writes, scoped to admin roles, **no money writes ever**.
 *
 * That last one is not enforced by remembering it. `MONEY_TABLES` is declared here, every
 * write tool declares which table it touches, and a test asserts no tool names one of
 * them. Adding a money-writing tool would fail CI, which is a stronger guarantee than a
 * comment saying not to.
 *
 * ── Why every write is a batch ─────────────────────────────────────────────
 *
 * A tool call arrives from a chat client, which means nobody is watching the diff. So
 * every write carries a batch id built from the call, and `npm run revert:batch` undoes
 * it as a unit. "Claude changed something and I do not know what" is recoverable;
 * without the batch it would not be.
 */

import { db } from '../data'
import { agentActor, humanActor, recordChanges, recordEvent } from '../audit'
import { canWrite } from '../rbac'
import { search } from '../search'
import { WORKERS, WORKER_NAMES } from '@/workers'
import { loadTemplate, loadTemplates } from '../templates'
import { monthToDate } from '../gateway'
import { cacheStats, requestStats } from '../airtable/cache'
import type { Role, User } from '../types'
import type { TableKey } from '../airtable/schema'

/**
 * The settings a chat client may change, addressed as `section.field`.
 *
 * An allowlist rather than a shape check: `ai.backend` decides which provider every model
 * call goes to and `ai.monthlyCapUsd` is the spend ceiling, so the set of things reachable
 * from a chat window is worth writing down and reviewing, not deriving.
 */
export const SETTABLE = [
  'ai.mode',
  'ai.monthlyCapUsd',
  'ai.pauseNonCriticalAtCap',
] as const satisfies readonly string[]

/** Tables no MCP tool may write, whatever role the caller has. */
export const MONEY_TABLES: TableKey[] = ['payments', 'scheduleLegs']

export interface ToolContext {
  user: User
  /** Groups every write from one call, so the whole call reverses together. */
  batchId: string
}

export interface McpTool {
  name: string
  description: string
  /** JSON Schema for the arguments, as the MCP protocol requires. */
  inputSchema: Record<string, unknown>
  minRole: Role
  /** Set on write tools. Checked against `MONEY_TABLES` by a test, and by `canWrite`. */
  writes?: TableKey
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function object(props: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties: props, required, additionalProperties: false }
}

const S = {
  string: (description: string) => ({ type: 'string', description }),
  number: (description: string) => ({ type: 'number', description }),
}

// ── Read tools ──────────────────────────────────────────────────────────────

const getDeal: McpTool = {
  name: 'get_deal',
  description: 'One deal in full, with its client, stage, dates, fee and open tasks.',
  inputSchema: object({ id: S.string('The deal record id.') }, ['id']),
  minRole: 'admin',
  async run(args) {
    const id = str(args.id)
    if (!id) throw new Error('id is required.')
    const provider = db()
    const deal = await provider.getDeal(id)
    if (!deal) throw new Error(`No deal ${id}.`)
    const tasks = await provider.listTasks({ dealId: id })
    return { deal, openTasks: tasks.filter((t) => !t.done) }
  },
}

const searchTool: McpTool = {
  name: 'search',
  description: 'Fuzzy search across deals, companies, contacts and drafts.',
  inputSchema: object(
    { query: S.string('What to look for.'), limit: S.number('Max results, default 10.') },
    ['query'],
  ),
  minRole: 'admin',
  async run(args) {
    const query = str(args.query)
    if (!query) throw new Error('query is required.')
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 50) : 10
    return { results: (await search(query)).slice(0, limit) }
  },
}

const queueSummary: McpTool = {
  name: 'queue_summary',
  description: 'What is waiting for a human: drafts, deal proposals and open date conflicts.',
  inputSchema: object({}),
  minRole: 'admin',
  async run() {
    const provider = db()
    const [drafts, proposals, conflicts] = await Promise.all([
      provider.listDrafts({ status: 'proposed' }),
      provider.listDealProposals('proposed'),
      provider.listDateConflicts(),
    ])
    const bySource: Record<string, number> = {}
    for (const p of proposals) bySource[p.seedSource] = (bySource[p.seedSource] ?? 0) + 1
    return {
      draftsAwaitingApproval: drafts.length,
      dealProposals: proposals.length,
      dealProposalsBySource: bySource,
      openDateConflicts: conflicts.filter((c) => c.status === 'open').length,
    }
  },
}

const usageMeter: McpTool = {
  name: 'usage_meter',
  description:
    'Two meters: model spend this month against the cap, and Airtable request rate with ' +
    'the per-table breakdown and what the cache saved.',
  inputSchema: object({}),
  minRole: 'admin',
  async run() {
    const requests = requestStats()
    return {
      ai: await monthToDate(),
      airtable: {
        ...requests,
        cache: cacheStats(),
        // Said plainly, because the number is easy to misread as a bill.
        note:
          'Counted in this server process only, so it is a rate and a shape rather than a ' +
          'month-to-date total. Airtable\'s own usage page is the authority on the bill; ' +
          'this is the one that says which table is spending it.',
      },
    }
  },
}

const workerStatus: McpTool = {
  name: 'worker_status',
  description: 'Every worker, its schedule, and whether it survives the AI cap.',
  inputSchema: object({}),
  minRole: 'admin',
  async run() {
    return {
      workers: WORKER_NAMES.map((name) => ({
        name,
        title: WORKERS[name]!.title,
        schedule: WORKERS[name]!.schedule,
        critical: WORKERS[name]!.critical,
      })),
    }
  },
}

const recentFailures: McpTool = {
  name: 'recent_failures',
  description: 'Worker failures recorded in the audit log, most recent first.',
  inputSchema: object({ limit: S.number('How many, default 20.') }),
  minRole: 'admin',
  async run(args) {
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 20
    const entries = await db().listAudit(undefined, 500)
    return {
      failures: entries
        .filter((e) => /fail|error/i.test(`${e.field} ${e.newValue ?? ''}`))
        .slice(0, limit),
    }
  },
}

const templateGet: McpTool = {
  name: 'template_get',
  description: 'One email template by key, or the list of keys when no key is given.',
  inputSchema: object({ key: S.string('Template key, e.g. proposal.standard.') }),
  minRole: 'admin',
  async run(args) {
    const key = str(args.key)
    if (!key) return { keys: (await loadTemplates()).map((t) => ({ key: t.key, label: t.label })) }
    const template = await loadTemplate(key)
    if (!template) throw new Error(`No template "${key}".`)
    return template
  },
}

// ── Write tools ─────────────────────────────────────────────────────────────

const templateUpdate: McpTool = {
  name: 'template_update',
  description: "Edit a template's subject or body. Audited, and reversible as a batch.",
  inputSchema: object(
    {
      key: S.string('Template key.'),
      subject: S.string('New subject. Omit to leave unchanged.'),
      body: S.string('New body. Omit to leave unchanged.'),
    },
    ['key'],
  ),
  minRole: 'admin',
  writes: 'templates',
  async run(args, ctx) {
    const key = str(args.key)
    if (!key) throw new Error('key is required.')
    const subject = str(args.subject)
    const body = str(args.body)
    if (!subject && !body) throw new Error('Give a subject, a body, or both.')

    const before = await loadTemplate(key)
    if (!before) throw new Error(`No template "${key}".`)

    const provider = db()
    const after = await provider.upsertTemplate(key, { subject, body })
    await recordChanges({
      table: 'templates',
      recordId: key,
      before: { subject: before.subject, body: before.body },
      after: { subject, body },
      actor: humanActor(ctx.user.email),
      source: 'MCP',
      batchId: ctx.batchId,
    })
    return { updated: key, template: after }
  },
}

const settingUpdate: McpTool = {
  name: 'setting_update',
  description:
    'Change one setting, addressed as section.field — for example ai.monthlyCapUsd or ' +
    'ai.mode. Money and auth settings are not reachable from here.',
  inputSchema: object(
    { key: S.string('section.field, e.g. "ai.monthlyCapUsd".'), value: { description: 'New value.' } },
    ['key', 'value'],
  ),
  minRole: 'admin',
  writes: 'settings',
  async run(args, ctx) {
    const key = str(args.key)
    if (!key) throw new Error('key is required.')

    // ── Why this validates instead of forwarding ────────────────────────
    //
    // It used to be `saveSettings({ [key]: value } as never)`. `saveSettings` merges
    // known sections and ignores everything else, so any key that was not "theme" or
    // "ai" changed nothing at all — while this tool returned `{ updated: key }` and
    // reported success. The same `as never` hid the same mistake in the calendar mirror,
    // where a run timestamp went unwritten for a month.
    //
    // An admin write that quietly does nothing is worse than one that refuses.
    const [section, field, ...rest] = key.split('.')
    if (!section || !field || rest.length > 0) {
      throw new Error(`Address a setting as section.field, not "${key}". Try ${SETTABLE.join(', ')}.`)
    }
    if (!(SETTABLE as readonly string[]).includes(key)) {
      throw new Error(`"${key}" is not settable from here. Try ${SETTABLE.join(', ')}.`)
    }

    const provider = db()
    const before = await provider.getSettings()
    const sectionBefore = (before as unknown as Record<string, Record<string, unknown>>)[section]
    const after = await provider.saveSettings({
      [section]: { ...sectionBefore, [field]: args.value },
    } as Parameters<typeof provider.saveSettings>[0])

    // Read back rather than trust the write. This tool's whole failure mode was
    // reporting a change it had not made.
    const applied = (after as unknown as Record<string, Record<string, unknown>>)[section]?.[field]
    if (applied !== args.value) {
      throw new Error(`${key} did not take: wrote ${JSON.stringify(args.value)}, read ${JSON.stringify(applied)}.`)
    }

    await recordChanges({
      table: 'settings',
      recordId: 'settings',
      before: { [key]: sectionBefore?.[field] },
      after: { [key]: args.value },
      actor: humanActor(ctx.user.email),
      source: 'MCP',
      batchId: ctx.batchId,
    })
    return { updated: key, settings: after }
  },
}

const runWorker: McpTool = {
  name: 'run_worker',
  description: 'Runs one worker now. The same function the cron calls.',
  inputSchema: object({ name: S.string(`One of: ${WORKER_NAMES.join(', ')}`) }, ['name']),
  minRole: 'admin',
  async run(args, ctx) {
    const name = str(args.name)
    if (!name) throw new Error('name is required.')
    const worker = WORKERS[name]
    if (!worker) throw new Error(`No worker "${name}". Try: ${WORKER_NAMES.join(', ')}`)

    const startedAt = Date.now()
    const result = await worker.run()
    await recordEvent({
      table: 'settings',
      recordId: 'workers',
      what: `Ran ${name}`,
      detail: `via MCP by ${ctx.user.email}`,
      actor: agentActor('MCP'),
      source: 'MCP',
      batchId: ctx.batchId,
    })
    return { worker: name, durationMs: Date.now() - startedAt, result }
  },
}

const resolveConflict: McpTool = {
  name: 'resolve_conflict',
  description: 'Marks a date conflict resolved, with the resolution a person chose.',
  inputSchema: object(
    {
      id: S.string('Date conflict record id.'),
      resolution: S.string(
        'First hold contracted | First hold released | Second hold released | Both feasible',
      ),
    },
    ['id', 'resolution'],
  ),
  minRole: 'admin',
  writes: 'dateConflicts',
  async run(args, ctx) {
    const id = str(args.id)
    const resolution = str(args.resolution)
    if (!id || !resolution) throw new Error('id and resolution are both required.')

    const { RESOLUTIONS, statusFor } = await import('../conflicts')
    if (!RESOLUTIONS.includes(resolution as never)) {
      throw new Error(`resolution must be one of: ${RESOLUTIONS.join(' | ')}`)
    }

    const provider = db()
    const updated = await provider.updateDateConflict(id, {
      status: statusFor(resolution as never),
      resolution,
      resolvedBy: ctx.user.email,
    })
    await recordEvent({
      table: 'dateConflicts',
      recordId: id,
      what: 'Resolved',
      detail: `${resolution}, via MCP by ${ctx.user.email}`,
      actor: humanActor(ctx.user.email),
      source: 'MCP',
      batchId: ctx.batchId,
      reversible: true,
    })
    return updated
  },
}

const addUser: McpTool = {
  name: 'add_user',
  description: 'Adds a user with a role. Cannot grant a role above the caller’s own.',
  inputSchema: object(
    {
      email: S.string('Their email.'),
      name: S.string('Their name.'),
      role: S.string('owner | admin | ops | accountant'),
    },
    ['email', 'role'],
  ),
  minRole: 'admin',
  writes: 'users',
  async run(args, ctx) {
    const email = str(args.email)
    const role = str(args.role) as Role | undefined
    if (!email || !role) throw new Error('email and role are both required.')
    if (!['owner', 'admin', 'ops', 'accountant'].includes(role)) {
      throw new Error('role must be owner, admin, ops or accountant.')
    }

    const provider = db()
    if ((await provider.listUsers()).some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error(`${email} already has an account.`)
    }

    const created = await provider.upsertUser({ email, name: str(args.name) ?? email, role })
    await recordEvent({
      table: 'users',
      recordId: created.id,
      what: 'User added',
      detail: `${email} as ${role}, via MCP by ${ctx.user.email}`,
      actor: humanActor(ctx.user.email),
      source: 'MCP',
      batchId: ctx.batchId,
      reversible: true,
    })
    return created
  },
}

export const TOOLS: McpTool[] = [
  getDeal,
  searchTool,
  queueSummary,
  usageMeter,
  workerStatus,
  recentFailures,
  templateGet,
  templateUpdate,
  settingUpdate,
  runWorker,
  resolveConflict,
  addUser,
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/**
 * Whether this caller may run this tool.
 *
 * Two gates, and both are needed. The role gate is the endpoint's own scope; the
 * `canWrite` gate is the same one every API route uses, so a tool cannot become a way
 * around a rule the app enforces.
 */
export function authorise(tool: McpTool, role: Role): { allowed: boolean; reason?: string } {
  if (role !== tool.minRole && !(role === 'admin' && tool.minRole !== 'admin')) {
    return { allowed: false, reason: `${tool.name} needs the ${tool.minRole} role.` }
  }
  if (tool.writes) {
    if (MONEY_TABLES.includes(tool.writes)) {
      return { allowed: false, reason: 'Money is never written from here.' }
    }
    const decision = canWrite(role, tool.writes)
    if (!decision.allowed) return { allowed: false, reason: decision.reason }
  }
  return { allowed: true }
}
