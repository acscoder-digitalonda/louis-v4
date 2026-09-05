/**
 * The script bank.
 *
 * These are the *fallback* copies of Connor's language. In production the Templates
 * table in Airtable is authoritative (white-label kit §8.3: "a new speaker = new voice,
 * same engine") — `loadTemplates()` reads the table and falls back to this file, so a
 * fresh install works before anyone has typed a word into Airtable.
 *
 * Placeholders are `{{name}}`; `render()` leaves an unknown placeholder visibly intact
 * rather than emitting an empty string, so a missing value is obvious in review.
 */

export interface Template {
  key: string
  label: string
  subject: string
  body: string
  notes?: string
}

export const TEMPLATES: Template[] = [
  {
    key: 'ack.inquiry',
    label: 'Inquiry acknowledgement',
    subject: 'Thanks for reaching out about {{eventName}}',
    body: `Hi {{contactFirstName}},

Thank you for getting in touch about {{eventName}}. I have your details and will come back to you within one business day with availability and next steps.

If it helps in the meantime, here is a short overview of what a session with {{speakerName}} looks like: {{overviewLink}}

Best,
The {{speakerName}} team`,
    notes: 'The only auto-sent message in the system. Keep it factual and promise-light.',
  },
  {
    key: 'proposal.standard',
    label: 'Proposal',
    subject: '{{speakerName}}: proposal for {{eventName}}',
    body: `Hi {{contactFirstName}},

Thank you for the conversation about {{eventName}} on {{eventDate}}. Here is what I am proposing.

The session: a {{stageTime}} keynote built around your audience of {{audienceProfile}}, tuned to the outcome you described: {{desiredOutcomes}}.

Fee: {{fee}}, inclusive of preparation and a pre-event planning call. Travel is billed at cost.

We are currently holding {{holdDate}}. That hold is soft, so if you would like to secure it, a signed agreement is the way.

Happy to talk through any of it.

Best,
{{speakerName}}`,
  },
  {
    key: 'followup.soft',
    label: 'Soft check-in (decision date + 2)',
    subject: 'Checking in on {{eventName}}',
    body: `Hi {{contactFirstName}},

Just a short note to check in on {{eventName}}. We are still holding {{holdDate}}, and I wanted to make sure you have everything you need on your side.

Anything I can answer?

Best,
{{speakerName}}`,
  },
  {
    key: 'followup.forcing',
    label: 'Forcing email (decision date + 7)',
    subject: 'Should we release the hold on {{holdDate}}?',
    body: `Hi {{contactFirstName}},

We have been holding {{holdDate}} for {{eventName}}. Another enquiry has come in for that week, so before I let the date go I wanted to check whether this is still live on your side.

A yes, a no, or a "not yet" are all genuinely useful. I would just rather know than guess.

Best,
{{speakerName}}`,
    notes: 'Firm, never pushy. The question is real: releasing the hold is a fine outcome.',
  },
  {
    key: 'kit.welcome',
    label: 'Welcome kit + questionnaire',
    subject: 'Welcome aboard, and a few things for {{eventName}}',
    body: `Hi {{contactFirstName}},

Delighted this is happening. A few things to get us moving:

1. The questionnaire: {{questionnaireLink}}. It takes about ten minutes and shapes the whole session.
2. Speaker assets (bio, headshots, AV rider): {{assetsLink}}
3. The planning call. I will send a couple of times for a 30-minute call about four weeks out.

We will take care of the rest.

Best,
The {{speakerName}} team`,
  },
  {
    key: 'chase.questionnaire',
    label: 'Questionnaire chase (T-14)',
    subject: 'Quick nudge on the questionnaire for {{eventName}}',
    body: `Hi {{contactFirstName}},

We are {{daysToEvent}} days out from {{eventName}} and I do not have the questionnaire back yet. It is the piece that lets {{speakerName}} tailor the session to your room, so I would love to get it in this week.

Here it is again: {{questionnaireLink}}

Best,
The {{speakerName}} team`,
  },
  {
    key: 'journal.promo',
    label: 'Journal promo follow-up',
    subject: 'The journal, for {{clientName}}',
    body: `Hi {{contactFirstName}},

I sent a few copies of the journal ahead of {{eventName}}. If it landed well, a lot of groups choose to put one in every attendee's hands on the day. It turns the keynote into something people actually do afterwards.

Quantities and lead time are easy; I just need a number and a ship-by date.

Best,
The {{speakerName}} team`,
  },
  {
    key: 'debrief.thankyou',
    label: 'Debrief + testimonial ask',
    subject: 'Thank you, and one small ask',
    body: `Hi {{contactFirstName}},

Thank you for having {{speakerName}} at {{eventName}}. The room was generous and the questions were excellent.

If the session landed, a short testimonial would mean a great deal. Two or three sentences is plenty.

And if there is a moment next year where this would be useful again, we would love to be part of it.

Best,
The {{speakerName}} team`,
  },
]

export const templatesByKey = new Map(TEMPLATES.map((t) => [t.key, t]))

export function getTemplate(key: string): Template | null {
  return templatesByKey.get(key) ?? null
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

/**
 * Fills a template. Unknown keys are left as `{{key}}` on purpose: a visible gap in
 * the review queue is safe, an invisible one is not.
 */
export function render(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key]
    if (value === null || value === undefined || value === '') return match
    return String(value)
  })
}

/** Placeholders still unfilled after render — the checker pass flags these. */
export function missingPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((v, i, a) => a.indexOf(v) === i)
}
