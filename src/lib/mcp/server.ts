/**
 * WP3.4 — the MCP wire protocol, which is JSON-RPC 2.0 over HTTP POST.
 *
 * Written by hand rather than pulled from the SDK, for the same reason `node:test` was
 * chosen over a test framework: the surface actually used here is four methods and a
 * fixed envelope, the SDK's transport is stateful in a way a serverless function is not,
 * and a dependency that ships a session manager to serve `tools/list` is a dependency
 * that will one day break a deploy for no benefit.
 *
 * Everything below is dispatch and error shaping. The tools are in `tools.ts`, the auth is
 * in `tokens.ts`, and neither knows this file exists.
 *
 * ── The bits of the protocol that are easy to get wrong ────────────────────
 *
 * A **notification** — a request with no `id` — gets no response at all, not a response
 * with a null id. `notifications/initialized` is the one that matters: answering it makes
 * some clients hang waiting for a reply to something they never asked about.
 *
 * A tool that **fails** is not a JSON-RPC error. The call succeeded; the tool reported a
 * problem. So it returns a normal result with `isError: true`, which is what lets a model
 * read the message and try something else instead of the client tearing down the session.
 * JSON-RPC errors are reserved for the envelope being wrong.
 */

import { TOOLS, TOOLS_BY_NAME, authorise, type ToolContext } from './tools'
import type { User } from '../types'

export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'louis', version: '4.0.0' }

export interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** The subset of JSON-RPC error codes this server can produce. */
export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function err(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/** A request with no id expects no reply. */
export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined || req.id === null
}

/** Tool results travel as content blocks, and text is the only kind this server sends. */
function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError,
  }
}

export interface DispatchOptions {
  user: User
  /** Injected so a test can pin it and a caller can trace one call through the audit log. */
  batchId?: string
  now?: () => Date
}

/**
 * Handles one JSON-RPC message. Returns null for a notification.
 *
 * The tool list is filtered by role rather than returned whole and refused on call: a
 * client that cannot see a tool will not offer it, and a model that never sees
 * `run_worker` will not spend a turn discovering it may not use it.
 */
export async function dispatch(
  req: JsonRpcRequest,
  opts: DispatchOptions,
): Promise<JsonRpcResponse | null> {
  if (req.jsonrpc !== '2.0') {
    return isNotification(req) ? null : err(req.id, RPC.invalidRequest, 'jsonrpc must be "2.0".')
  }
  if (!req.method) {
    return isNotification(req) ? null : err(req.id, RPC.invalidRequest, 'method is required.')
  }

  // Notifications first: they are answered with silence, and answering them is the bug.
  if (isNotification(req)) {
    return null
  }

  switch (req.method) {
    case 'initialize':
      return ok(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Louis is the operations system for one keynote speaker. Reads are safe. Writes are ' +
          'audited, reversible as a batch, and never touch money.',
      })

    case 'ping':
      return ok(req.id, {})

    case 'tools/list':
      return ok(req.id, {
        tools: TOOLS.filter((t) => authorise(t, opts.user.role).allowed).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : ''
      const tool = TOOLS_BY_NAME.get(name)
      if (!tool) return err(req.id, RPC.invalidParams, `No tool "${name}".`)

      const decision = authorise(tool, opts.user.role)
      if (!decision.allowed) {
        // A refusal is a tool result, not a transport error: the caller should hear why
        // and stop, rather than treat it as the connection being broken.
        return ok(req.id, textResult(`Refused: ${decision.reason}`, true))
      }

      const args = (req.params?.arguments ?? {}) as Record<string, unknown>
      const ctx: ToolContext = {
        user: opts.user,
        batchId: opts.batchId ?? defaultBatchId(name, opts.now?.() ?? new Date()),
      }

      try {
        return ok(req.id, textResult(await tool.run(args, ctx)))
      } catch (error) {
        // The tool spoke; it just said no. Anything else and the model cannot recover.
        return ok(req.id, textResult(error instanceof Error ? error.message : String(error), true))
      }
    }

    default:
      return err(req.id, RPC.methodNotFound, `Unknown method "${req.method}".`)
  }
}

/** Readable in the audit log and unique enough to revert one call and not another. */
export function defaultBatchId(tool: string, at: Date): string {
  return `mcp-${tool}-${at.toISOString().replace(/[-:T]/g, '').slice(0, 15)}`
}

/** A batch may arrive as an array. Notifications inside it still produce no response. */
export async function dispatchBatch(
  body: unknown,
  opts: DispatchOptions,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return err(null, RPC.invalidRequest, 'Empty batch.')
    const out: JsonRpcResponse[] = []
    for (const item of body) {
      const res = await dispatch(item as JsonRpcRequest, opts)
      if (res) out.push(res)
    }
    return out.length > 0 ? out : null
  }
  if (!body || typeof body !== 'object') {
    return err(null, RPC.invalidRequest, 'Body must be a JSON-RPC object or array.')
  }
  return dispatch(body as JsonRpcRequest, opts)
}
