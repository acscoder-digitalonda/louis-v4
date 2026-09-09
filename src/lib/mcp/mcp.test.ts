import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '../data'
import { MockProvider } from '../data/mock'
import { setProviderRunner } from '../gateway'
import { TOKEN_PREFIX, authenticate, bearerFrom, hashToken, issueToken, roleAllowed } from './tokens'
import { MONEY_TABLES, TOOLS, TOOLS_BY_NAME, authorise, SETTABLE } from './tools'
import { PROTOCOL_VERSION, RPC, defaultBatchId, dispatch, dispatchBatch, isNotification } from './server'
import type { ApiToken, Role, User } from '../types'

const user = (role: Role = 'admin', over: Partial<User> = {}): User =>
  ({ id: 'u1', name: 'Jordan', email: 'jordan@bennemtin.com', role, active: true, ...over }) as User

const token = (over: Partial<ApiToken> = {}): ApiToken => ({
  id: 't1',
  label: 'Jordan · laptop',
  tokenHash: hashToken(`${TOKEN_PREFIX}abc`),
  prefix: `${TOKEN_PREFIX}abc`,
  userEmail: 'jordan@bennemtin.com',
  createdAt: '2026-09-01T00:00:00Z',
  lastUsedAt: null,
  expiresAt: null,
  revoked: false,
  ...over,
})

let provider: DataProvider
before(() => {
  provider = new MockProvider()
  setProvider(provider)
  setProviderRunner(async () => ({ text: '{}', tokensIn: 1, tokensOut: 1, estimated: true }))
})
after(() => {
  setProvider(null)
  setProviderRunner(null)
})

describe('tokens', () => {
  it('issues a token that is never equal to what is stored', () => {
    // The base is exported to a git repo nightly. A stored credential would be a
    // credential in every backup.
    const t = issueToken()
    assert.ok(t.token.startsWith(TOKEN_PREFIX))
    assert.notEqual(t.token, t.hash)
    assert.equal(t.hash, hashToken(t.token))
    assert.ok(!t.hash.includes(t.token.slice(TOKEN_PREFIX.length)))
  })

  it('shows only enough of the token to identify it', () => {
    const t = issueToken()
    assert.ok(t.prefix.length < t.token.length / 2, 'the prefix cannot reconstruct the token')
    assert.ok(t.token.startsWith(t.prefix))
  })

  it('issues a different token every time', () => {
    assert.notEqual(issueToken().token, issueToken().token)
  })

  it('reads a bearer header, and only a bearer header', () => {
    assert.equal(bearerFrom('Bearer abc'), 'abc')
    assert.equal(bearerFrom('bearer  abc  '), 'abc')
    assert.equal(bearerFrom('Basic abc'), null)
    assert.equal(bearerFrom(null), null)
  })
})

describe('authenticate', () => {
  const users = [user()]

  it('resolves a good token to its user', () => {
    const result = authenticate(`${TOKEN_PREFIX}abc`, [token()], users)
    assert.equal(result.ok, true)
    assert.equal(result.user?.email, 'jordan@bennemtin.com')
  })

  it('refuses a revoked token', () => {
    assert.equal(authenticate(`${TOKEN_PREFIX}abc`, [token({ revoked: true })], users).ok, false)
  })

  it('refuses an expired token', () => {
    const t = token({ expiresAt: '2026-01-01' })
    assert.equal(authenticate(`${TOKEN_PREFIX}abc`, [t], users, '2026-09-07').ok, false)
    assert.equal(authenticate(`${TOKEN_PREFIX}abc`, [t], users, '2025-12-31').ok, true)
  })

  it('refuses a token whose user no longer exists', () => {
    // Not a token belonging to nobody: a token belonging to somebody who left.
    assert.equal(authenticate(`${TOKEN_PREFIX}abc`, [token()], []).ok, false)
  })

  it('gives the same message whatever went wrong', () => {
    // Distinguishing "no such token" from "revoked" lets anyone enumerate which tokens
    // once existed, and the caller can do nothing differently with the difference.
    const messages = new Set(
      [
        authenticate(null, [token()], users),
        authenticate('nonsense', [token()], users),
        authenticate(`${TOKEN_PREFIX}wrong`, [token()], users),
        authenticate(`${TOKEN_PREFIX}abc`, [token({ revoked: true })], users),
        authenticate(`${TOKEN_PREFIX}abc`, [token()], []),
      ].map((r) => r.message),
    )
    assert.equal(messages.size, 1)
  })

  it('never returns the token in the failure', () => {
    const result = authenticate(`${TOKEN_PREFIX}abc`, [], users)
    assert.equal(JSON.stringify(result).includes('abc'), false)
  })
})

describe('who may reach the endpoint', () => {
  it('is admin only', () => {
    assert.equal(roleAllowed('admin'), true)
    for (const r of ['owner', 'ops', 'accountant'] as const) {
      assert.equal(roleAllowed(r), false, r)
    }
  })
})

describe('tools', () => {
  it('exposes exactly the list Jordan specified', () => {
    assert.deepEqual(
      TOOLS.map((t) => t.name).sort(),
      [
        'add_user', 'get_deal', 'queue_summary', 'recent_failures', 'resolve_conflict',
        'run_worker', 'search', 'setting_update', 'template_get', 'template_update',
        'usage_meter', 'worker_status',
      ],
    )
  })

  it('never writes money, and cannot be made to', () => {
    // The guarantee is structural, not a promise: a tool that named a money table would
    // fail this test rather than reach production.
    for (const tool of TOOLS) {
      if (!tool.writes) continue
      assert.equal(MONEY_TABLES.includes(tool.writes), false, `${tool.name} writes ${tool.writes}`)
    }
  })

  it('refuses every tool to a non-admin', () => {
    for (const role of ['owner', 'ops', 'accountant'] as const) {
      for (const tool of TOOLS) {
        assert.equal(authorise(tool, role).allowed, false, `${role} / ${tool.name}`)
      }
    }
  })

  it('gives a reason for every refusal', () => {
    for (const tool of TOOLS) {
      const d = authorise(tool, 'ops')
      assert.ok(d.reason && d.reason.length > 0, tool.name)
    }
  })

  it('declares a JSON Schema for every tool', () => {
    // The client builds its call from this. A missing schema is a tool a model guesses at.
    for (const tool of TOOLS) {
      assert.equal((tool.inputSchema as { type?: string }).type, 'object', tool.name)
      assert.ok(tool.description.length > 20, `${tool.name} needs a real description`)
    }
  })

  it('names the table every write tool touches', () => {
    // Without this the money check above has nothing to check.
    for (const name of ['template_update', 'setting_update', 'resolve_conflict', 'add_user']) {
      assert.ok(TOOLS_BY_NAME.get(name)?.writes, `${name} must declare its table`)
    }
  })
})

describe('the JSON-RPC layer', () => {
  const opts = { user: user() }

  it('answers initialize with a protocol version and capabilities', async () => {
    const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' }, opts)
    const result = res!.result as { protocolVersion: string; capabilities: unknown }
    assert.equal(result.protocolVersion, PROTOCOL_VERSION)
    assert.ok(result.capabilities)
  })

  it('says nothing at all to a notification', async () => {
    // Answering `notifications/initialized` makes some clients hang waiting for a reply
    // to something they never asked about.
    assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, opts), null)
    assert.ok(isNotification({ jsonrpc: '2.0', method: 'x' }))
    assert.equal(isNotification({ jsonrpc: '2.0', id: 0, method: 'x' }), false)
  })

  it('lists only the tools this caller may run', async () => {
    const asAdmin = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, opts)
    assert.equal((asAdmin!.result as { tools: unknown[] }).tools.length, TOOLS.length)

    const asOps = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { user: user('ops') })
    assert.deepEqual((asOps!.result as { tools: unknown[] }).tools, [])
  })

  it('rejects a bad envelope as a JSON-RPC error', async () => {
    const res = await dispatch({ id: 1, method: 'initialize' }, opts)
    assert.equal(res!.error?.code, RPC.invalidRequest)

    const unknown = await dispatch({ jsonrpc: '2.0', id: 1, method: 'nope' }, opts)
    assert.equal(unknown!.error?.code, RPC.methodNotFound)
  })

  it('reports a failing tool as a result, not a transport error', async () => {
    // The call succeeded; the tool said no. A JSON-RPC error would tear down the session
    // instead of letting the model read the message and try something else.
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_deal', arguments: { id: 'nope' } } },
      opts,
    )
    assert.equal(res!.error, undefined)
    assert.equal((res!.result as { isError: boolean }).isError, true)
  })

  it('refuses an unauthorised tool as a result the caller can read', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_worker', arguments: { name: 'f6-timers' } } },
      { user: user('ops') },
    )
    const result = res!.result as { isError: boolean; content: { text: string }[] }
    assert.equal(result.isError, true)
    assert.match(result.content[0]!.text, /Refused/)
  })

  it('runs a read tool end to end', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'queue_summary' } },
      opts,
    )
    assert.equal(res!.id, 7)
    const payload = JSON.parse((res!.result as { content: { text: string }[] }).content[0]!.text)
    assert.equal(typeof payload.dealProposals, 'number')
  })

  it('handles a batch, dropping the notifications', async () => {
    const out = (await dispatchBatch(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ],
      opts,
    )) as { id: number }[]
    assert.deepEqual(out.map((r) => r.id), [1, 2])
  })

  it('rejects a body that is not an object or an array', async () => {
    const res = (await dispatchBatch('hello', opts)) as { error: { code: number } }
    assert.equal(res.error.code, RPC.invalidRequest)
  })

  it('gives each call a batch id that names the tool and the time', () => {
    // "Claude changed something and I do not know what" has to be recoverable.
    const id = defaultBatchId('template_update', new Date('2026-09-07T11:30:00Z'))
    assert.match(id, /^mcp-template_update-20260907/)
  })
})

describe('a write, end to end', () => {
  it('edits a template and leaves a reversible trail', async () => {
    const res = await dispatch(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'template_update',
          arguments: { key: 'chase.questionnaire', subject: 'Questionnaire for {{eventName}}' },
        },
      },
      { user: user(), batchId: 'test-batch' },
    )
    assert.equal((res!.result as { isError: boolean }).isError, false)

    const audit = await provider.listAudit(undefined, 50)
    const entry = audit.find((e) => e.batchId === 'test-batch')
    assert.ok(entry, 'the change is in the audit log')
    assert.equal(entry.actor, 'jordan@bennemtin.com', 'attributed to the person, not the robot')
    assert.equal(entry.source, 'MCP', 'and to the door they came through')
    assert.equal(entry.reversible, true)
  })
})

describe('setting_update refuses rather than pretending', () => {
  const tool = TOOLS.find((t) => t.name === 'setting_update')!
  const ctx = { user: { email: 'a@test.example', role: 'admin' } as never, batchId: 'test' }

  it('rejects a bare key, because a bare key silently changed nothing', () => {
    // It used to be `saveSettings({ [key]: value } as never)`. saveSettings merges known
    // sections and ignores the rest, so "monthlyCapUsd" changed nothing while the tool
    // returned `{ updated: 'monthlyCapUsd' }`. An admin write that quietly does nothing
    // is worse than one that refuses.
    return assert.rejects(
      () => tool.run({ key: 'monthlyCapUsd', value: 200 }, ctx),
      /section\.field/,
    )
  })

  it('rejects a section it does not own', () => {
    return assert.rejects(() => tool.run({ key: 'ai.backend', value: 'x' }, ctx), /not settable/)
  })

  it('rejects a nested path it cannot address', () => {
    return assert.rejects(() => tool.run({ key: 'ai.tierModels.haiku', value: 'x' }, ctx), /section\.field/)
  })

  it('names what is settable in the refusal, so the caller can retry', () => {
    return assert.rejects(
      () => tool.run({ key: 'theme.light', value: {} }, ctx),
      (err: Error) => {
        for (const k of SETTABLE) assert.ok(err.message.includes(k), k)
        return true
      },
    )
  })
})
