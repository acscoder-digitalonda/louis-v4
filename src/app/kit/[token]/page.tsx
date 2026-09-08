import { notFound } from 'next/navigation'
import { db } from '@/lib/data'
import { publicKit } from '@/lib/kit'
import { shortDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The welcome kit, as the client sees it.
 *
 * Outside `(app)`, so it inherits no navigation, no session and no chrome: a client who
 * opens this must not see a link to the pipeline. It is the only unauthenticated page in
 * the product, and the token in the URL is the only thing guarding it.
 *
 * Everything rendered comes from `publicKit`, which is an allowlist. Nothing on this page
 * reaches into the deal directly, so a field added to `Deal` next month cannot appear here
 * by accident.
 */
export default async function KitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 16) notFound()

  // One indexed read, not the whole table: this URL is unauthenticated and anyone can
  // hit it, so a wrong token must not cost nine Airtable requests.
  let deal
  try {
    deal = await db().getDealByKitToken(token)
  } catch (err) {
    // The backend is unreachable. A client seeing a stack trace on a page we sent them
    // is worse than a client seeing a sentence, so this is neither a 404 nor a 500.
    console.error('[kit] could not read the deal', err)
    return <Unavailable />
  }

  // A wrong token is a 404, not "no such kit": the two answers together would let anyone
  // learn which tokens exist by trying.
  if (!deal) notFound()

  const kit = publicKit(deal)

  return (
    <main className="mx-auto max-w-[680px] px-6 py-12">
      <p className="micro">Welcome aboard</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight">{kit.eventName}</h1>
      <p className="body-copy mt-3 text-ink-secondary">
        Everything for your session with {kit.speakerName}, in one place. This page stays
        current, so it is worth bookmarking rather than printing.
      </p>

      <section className="card mt-8">
        <p className="micro">The day</p>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <Fact label="Date" value={shortDate(kit.eventDate)} />
          <Fact label="Location" value={kit.location} />
          <Fact label="On stage" value={kit.stageTime} />
          <Fact label="AV check" value={kit.avCheckTime} />
          {kit.eventTimezone ? <Fact label="Timezone" value={kit.eventTimezone} /> : null}
          {kit.kickoffDate ? <Fact label="Planning call" value={shortDate(kit.kickoffDate)} /> : null}
        </dl>
      </section>

      {kit.audienceProfile || kit.desiredOutcomes ? (
        <section className="card mt-4">
          <p className="micro">What you told us</p>
          {kit.audienceProfile ? (
            <p className="body-copy mt-2">
              <b>Your room.</b> {kit.audienceProfile}
            </p>
          ) : null}
          {kit.desiredOutcomes ? (
            <p className="body-copy mt-2">
              <b>What you want them to leave with.</b> {kit.desiredOutcomes}
            </p>
          ) : null}
          <p className="sub mt-3">
            If any of that has changed, the questionnaire below is the place to say so.
          </p>
        </section>
      ) : null}

      <section className="card mt-4">
        <p className="micro">Two things from you</p>
        <ol className="mt-2 list-decimal space-y-3 pl-5">
          <li className="body-copy">
            <b>The questionnaire.</b> About ten minutes, and it shapes the whole session.
            {kit.questionnaireUrl ? (
              <>
                {' '}
                <a href={kit.questionnaireUrl} className="underline">
                  Open it here
                </a>
                . Your details are already filled in.
              </>
            ) : (
              <> We will send the link separately.</>
            )}
          </li>
          <li className="body-copy">
            <b>A planning call.</b> Thirty minutes, about four weeks out. We will offer a
            couple of times.
          </li>
        </ol>
      </section>

      {kit.assetsUrl ? (
        <section className="card mt-4">
          <p className="micro">Speaker assets</p>
          <p className="body-copy mt-2">
            Bio, headshots and the AV rider:{' '}
            <a href={kit.assetsUrl} className="underline">
              download here
            </a>
            .
          </p>
        </section>
      ) : null}

      <p className="sub mt-8">
        {kit.throughAgent
          ? 'Questions go through your bureau contact, who is copied on everything.'
          : `Anything at all, reply to the email this came from and the ${kit.speakerName} team will pick it up.`}
      </p>
    </main>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="micro">{label}</dt>
      <dd className="body-copy mt-1">{value || 'to be confirmed'}</dd>
    </div>
  )
}

/** Shown when the backend is down. No detail, and nothing that reads like an error. */
function Unavailable() {
  return (
    <main className="mx-auto max-w-[520px] px-6 py-20 text-center">
      <p className="micro">One moment</p>
      <h1 className="mt-2 text-[22px] font-semibold">This page is briefly unavailable.</h1>
      <p className="body-copy mt-3 text-ink-secondary">
        Nothing is wrong with your booking. Try again in a minute, or reply to the email this
        link came from and a person will pick it up.
      </p>
    </main>
  )
}
