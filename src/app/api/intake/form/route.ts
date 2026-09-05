import { NextResponse } from 'next/server'
import { formSchema, handleFormSubmission } from '@/workers/f1-form-intake'
import { notifyWorkerFailure } from '@/lib/notify'
import { fail } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * F1 — the public front door. This is the only unauthenticated write endpoint in the app.
 *
 * Guards: a shared token when configured, a size cap, a honeypot field, and strict
 * validation. It creates an Inquiry and nothing else — there is no field here that can
 * reach money, stage beyond Inquiry, or any user record.
 */
export async function POST(request: Request) {
  try {
    const token = process.env.FORM_INTAKE_TOKEN
    if (token) {
      const provided =
        request.headers.get('x-intake-token') ?? new URL(request.url).searchParams.get('token')
      if (provided !== token) {
        return NextResponse.json({ error: 'Bad token.' }, { status: 401 })
      }
    }

    const text = await request.text()
    if (text.length > 20_000) {
      return NextResponse.json({ error: 'Payload too large.' }, { status: 413 })
    }

    const raw = JSON.parse(text) as Record<string, unknown>
    // Honeypot: a real person never fills a hidden field.
    if (typeof raw.website_url === 'string' && raw.website_url.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    const input = formSchema.parse(raw)
    const deal = await handleFormSubmission(input)

    return NextResponse.json({ ok: true, dealId: deal.id }, { status: 201 })
  } catch (err) {
    // The submitter gets a clean answer; an admin gets the detail.
    void notifyWorkerFailure({ worker: 'F1 form intake', error: err }).catch(() => undefined)
    if (err instanceof Error && err.name === 'ZodError') {
      return NextResponse.json({ error: 'Please check the form fields.' }, { status: 400 })
    }
    return fail(err)
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': process.env.FORM_INTAKE_ORIGIN ?? '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-intake-token',
    },
  })
}
