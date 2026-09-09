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
    // A submission that fails validation is the submitter's problem, answered with a 400.
    // It used to reach the failure notifier first, so every malformed POST — a bot, a
    // probe, an empty body — emailed the admins a stack trace. This is a public endpoint;
    // what a stranger can send must not be able to page anyone.
    if (err instanceof Error && err.name === 'ZodError') {
      return NextResponse.json({ error: 'Please check the form fields.' }, { status: 400 })
    }
    // Everything else is ours — a provider down, a packet that threw — and an admin
    // should hear about it, once per six hours per cause.
    void notifyWorkerFailure({ worker: 'F1 form intake', error: err }).catch(() => undefined)
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
