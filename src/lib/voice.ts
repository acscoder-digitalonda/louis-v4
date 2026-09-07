/**
 * WP1.5 — VOICE CHECKER. Does this read like the office wrote it?
 *
 * Decisions Log §5 names what it flags: dashes, missing contractions, over-length, banned
 * openers, and a missing closing question or handoff. Advisory, not blocking — a checker
 * that refuses to let a draft through teaches people to work around it, and the drafts it
 * blocks are the ones somebody needed to send five minutes ago.
 *
 * Every rule here is deterministic. A model could judge tone better, but a model costs a
 * call per draft, disagrees with itself run to run, and cannot be argued with. These rules
 * are wrong in the same way every time, which is a property you can work with. The model
 * pass in `checkDraft` is a separate thing and checks facts, not voice.
 *
 * The one rule that is not a matter of taste is the dash: it is in Jordan's acceptance
 * list (§4, "no em/en dashes anywhere in client-facing copy") because it is the single
 * clearest tell that a machine wrote the sentence.
 */

export type VoiceSeverity = 'must' | 'should'

export interface VoiceIssue {
  rule: string
  severity: VoiceSeverity
  message: string
  /** The offending text, when there is a specific one. */
  sample?: string
}

/** Openers that announce the writer has nothing to say yet. */
const BANNED_OPENERS = [
  'i hope this finds you well',
  'i hope this email finds you well',
  'hope this finds you well',
  'i hope you are doing well',
  'i hope all is well',
  'just checking in to see',
  'i wanted to reach out',
  'i am reaching out to',
]

/** Words whose contracted form is how a person actually speaks. */
const UNCONTRACTED = [
  [/\bit is\b/gi, "it's"],
  [/\bwe are\b/gi, "we're"],
  [/\bwe will\b/gi, "we'll"],
  [/\byou are\b/gi, "you're"],
  [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bcannot\b/gi, "can't"],
  [/\bthat is\b/gi, "that's"],
  [/\bthere is\b/gi, "there's"],
  [/\bI am\b/g, "I'm"],
] as const

/** Superlatives and enthusiasm the office does not write. */
const OVERCOOKED = [
  /\bexcited to\b/i,
  /\bthrilled to\b/i,
  /\bdelighted to announce\b/i,
  /\bamazing\b/i,
  /\bincredible\b/i,
  /\bworld-class\b/i,
  /\bgame-chang/i,
]

export const MAX_WORDS = 220
export const MAX_SENTENCE_WORDS = 34

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Checks a draft against the house voice.
 *
 * `must` is a rule with an objective answer that Jordan's acceptance list names.
 * `should` is judgement, and a person is free to disagree.
 */
export function checkVoice(subject: string, body: string): VoiceIssue[] {
  const issues: VoiceIssue[] = []
  const text = `${subject}\n${body}`

  // ── must ────────────────────────────────────────────────────────────────
  const dash = text.match(/[–—]/)
  if (dash) {
    issues.push({
      rule: 'dash',
      severity: 'must',
      message: 'Em and en dashes do not appear in client-facing copy. Use a comma, a colon or two sentences.',
      sample: text.slice(Math.max(0, text.indexOf(dash[0]) - 30), text.indexOf(dash[0]) + 30).trim(),
    })
  }

  if (/!/.test(body)) {
    issues.push({
      rule: 'exclamation',
      severity: 'must',
      message: 'No exclamation marks. The enthusiasm should be in what is offered, not the punctuation.',
    })
  }

  const opener = sentences(body)[0]?.toLowerCase() ?? ''
  const banned = BANNED_OPENERS.find((b) => opener.includes(b))
  if (banned) {
    issues.push({
      rule: 'opener',
      severity: 'must',
      message: 'Opens with a phrase that says nothing. Start with the reason for writing.',
      sample: banned,
    })
  }

  // ── should ──────────────────────────────────────────────────────────────
  const total = words(body)
  if (total > MAX_WORDS) {
    issues.push({
      rule: 'length',
      severity: 'should',
      message: `${total} words. Over ${MAX_WORDS} and it stops being read on a phone.`,
    })
  }

  const longest = sentences(body).find((s) => words(s) > MAX_SENTENCE_WORDS)
  if (longest) {
    issues.push({
      rule: 'sentence-length',
      severity: 'should',
      message: `A sentence runs ${words(longest)} words. Break it.`,
      sample: longest.slice(0, 80),
    })
  }

  for (const [pattern, contraction] of UNCONTRACTED) {
    const hit = body.match(pattern)
    if (hit) {
      issues.push({
        rule: 'contraction',
        severity: 'should',
        message: `"${hit[0]}" reads stiff. "${contraction}" is how a person says it.`,
        sample: hit[0],
      })
      break // One example is enough; a list of ten teaches nothing more.
    }
  }

  const cooked = OVERCOOKED.find((p) => p.test(body))
  if (cooked) {
    issues.push({
      rule: 'superlative',
      severity: 'should',
      message: 'Reads like marketing. Say the specific thing instead.',
      sample: body.match(cooked)?.[0],
    })
  }

  if (!hasClosing(body)) {
    issues.push({
      rule: 'closing',
      severity: 'should',
      message: 'Ends without a question or a next step. The reader should know what to do.',
    })
  }

  return issues
}

/** Everything from the sign-off down. Not part of the message. */
const SIGN_OFF = /\n\s*(best|thanks|thank you|regards|warmly|cheers)[,.]?\s*\n[\s\S]*$/i

/**
 * Does the draft end by handing something to the reader?
 *
 * Two things this has to get right, both learned by getting them wrong.
 *
 * The sign-off is stripped first. "Best, / The Ben Nemtin team" is two sentences of
 * nothing, and leaving them in pushed the actual close out of the window — the forcing
 * email, whose whole point is "a yes, a no, or a not yet are all useful", failed.
 *
 * And a next step is not always a question. "I just need a number and a ship-by date" and
 * "here is the link" both hand the reader something to do; insisting on a question mark
 * would rewrite good copy into interrogations.
 */
export function hasClosing(body: string): boolean {
  const message = body.replace(SIGN_OFF, '')
  const tail = sentences(message).slice(-3).join(' ')
  if (tail.includes('?')) return true
  return new RegExp(
    [
      // asking for something
      'let me know', 'shall i', 'would you', 'can you', 'i just need', 'i need a',
      'rather know', 'all (genuinely )?useful', 'happy to',
      // promising something
      "i will send", "i'll send", 'we will take care', 'i will come back',
      // giving something
      'here is', "here's", 'here it is', 'link', 'next step',
      // opening a door
      'would love to', 'would mean', 'be part of it',
    ].map((p) => `\\b${p}\\b`).join('|'),
    'i',
  ).test(tail)
}

/** True when nothing in Jordan's acceptance list is broken. Advisory issues may remain. */
export function passesAcceptance(issues: VoiceIssue[]): boolean {
  return !issues.some((i) => i.severity === 'must')
}

/** One line per issue, for the review queue. */
export function summarise(issues: VoiceIssue[]): string {
  if (issues.length === 0) return 'Reads clean.'
  return issues
    .map((i) => `${i.severity === 'must' ? '!' : '·'} ${i.message}${i.sample ? ` ("${i.sample}")` : ''}`)
    .join('\n')
}
