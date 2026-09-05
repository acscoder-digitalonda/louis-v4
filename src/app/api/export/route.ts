import { NextResponse } from 'next/server'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { canSeeMoneyAmounts, canViewScreen } from '@/lib/rbac'
import { exportHubspot, exportJournal, exportNative, type HubspotFile } from '@/workers/f12-export'
import { agentActor, recordEvent } from '@/lib/audit'
import { fail } from '@/lib/http'

export const dynamic = 'force-dynamic'

const NATIVE_TABLES = ['deals', 'clients', 'contacts', 'journalOrders'] as const
const HUBSPOT_FILES = ['companies', 'contacts', 'deals'] as const

/**
 * Everything is extractable at all times. The one gate is money: a role that cannot see
 * amounts does not get a CSV of them either — hiding a column in the UI and shipping it
 * in an export would be theatre.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser()
    if (!canViewScreen(user.role, 'import-export') && user.role !== 'ops' && user.role !== 'owner') {
      throw new ForbiddenError('Your role cannot export.')
    }

    const url = new URL(request.url)
    const profile = url.searchParams.get('profile') ?? 'native'
    const table = url.searchParams.get('table') ?? 'deals'

    let file
    if (profile === 'hubspot') {
      if (!(HUBSPOT_FILES as readonly string[]).includes(table)) {
        return NextResponse.json({ error: `Unknown HubSpot file "${table}".` }, { status: 400 })
      }
      if (table === 'deals' && !canSeeMoneyAmounts(user)) {
        throw new ForbiddenError('The deals export includes amounts, which your role cannot see.')
      }
      file = await exportHubspot(table as HubspotFile)
    } else if (table === 'journalOrders') {
      file = await exportJournal()
    } else {
      if (!(NATIVE_TABLES as readonly string[]).includes(table)) {
        return NextResponse.json({ error: `Unknown table "${table}".` }, { status: 400 })
      }
      if (table === 'deals' && !canSeeMoneyAmounts(user)) {
        throw new ForbiddenError('The deals export includes fees, which your role cannot see.')
      }
      file = await exportNative(table as (typeof NATIVE_TABLES)[number])
    }

    await recordEvent({
      table: 'settings',
      recordId: 'export',
      what: 'Export downloaded',
      detail: `${profile}/${table} — ${file.rows} rows by ${user.email}`,
      actor: agentActor('F12'),
      source: 'export',
    })

    return new NextResponse(file.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return fail(err)
  }
}
