# Decisions

The spec's §7 open questions, answered — and the calls made while building that a
reviewer should be able to argue with.

Anything marked **Jordan's call** is implemented one way but designed to change with a
config edit rather than a rewrite. Say the word and it changes.

---

## The five open questions (Rebuild Spec §7)

### 1. "Updates/changes in emails" — which reading?

**Built: both.**

The inbound reading is F4 as specced — empty field gets a silent fill plus an audit
entry; a conflicting value becomes a Proposal in the Review Queue with the source email
attached, never a silent overwrite.

The outbound reading turned out to cost almost nothing, so it is in too: `Draft.revisions`
keeps what a person changed before approving, with who and when. If Liezel rewrites half
a forcing email, that is a signal about the template, and the Templates table is where
you would act on it.

### 2. Notification channels — is Slack a third fanout?

**Built: in-app + email. The schema does not block Slack, and adding it is small.**

`Notification.type` and the per-user preference matrix are already channel-agnostic;
`notify.ts` fans out through one function. A Slack channel means adding a case there and
a column to the preference grid — an afternoon, not a migration.

It was left out because Slack would be the first place a client-facing leak could
happen if the warehouse channel has guests in it, and `assertInternal` cannot check a
Slack channel's membership the way it checks an email domain. **Jordan's call**: if the
channel is internal-only, say so and it goes in.

### 3. Ben's money visibility — confirm the default

**Built: chips-only by default, amounts a per-user toggle.** As specced.

It is a field on the user record (`showMoneyAmounts`), flipped by an admin in
Settings → Users, so changing Ben's mind is a checkbox rather than a deploy. The gate is
server-side: a role that cannot see amounts also cannot export them, because hiding a
column in the UI while shipping it in a CSV is theatre.

### 4. Second provider for the fallback tier

**Built: Gemini, as the configured default.**

`google/gemini-2.5-flash` for the Haiku tier and `google/gemini-2.5-pro` for Sonnet and
Opus. Reasoning: the fallback exists for Anthropic outages, so it should be a genuinely
different provider; Gemini Flash is the cheapest thing that can do the classify and
checker work that makes up most of the call volume; and it is one field in Settings → AI
if you would rather test against OpenAI.

Nothing in the code names a provider outside `src/lib/gateway/`.

### 5. Multi-speaker: installs we operate, or SaaS?

**Built assuming installs — template, not tenant.** As the spec assumes.

Concretely: one speaker = one repo fork, one Airtable base, one Vercel project, one
Google workspace connection. `speaker.config.ts` holds every speaker-specific value, and
`scripts/bootstrap-base.ts` creates the schema in an empty base. There is no tenant id
anywhere, deliberately — adding one later is real work, and adding one *now* would be
paying for a decision nobody has made.

If this becomes SaaS, the honest answer is that it is a different build, and the seams
that survive are the data provider and the gateway.

---

## Calls made during the build

### Demo mode instead of a dev login

The spec says Google SSO only, no password path, ever. That left "how does anyone see
this before the Google project exists?"

Rather than add a dev-only credentials provider — a password path with a fence around it,
and fences come down — the app runs in **demo mode** when SSO is not configured: no
sign-in at all, a fixed admin identity, mock data. `authMode()` throws in production, so
the fence is the environment rather than a flag someone can flip.

### The mock provider is a first-class implementation

Not a stub. It backs every screen, so CI runs a full build with no secrets and a reviewer
sees real-looking data on clone. See ARCHITECTURE §5.

### Checker passes are deterministic first, model second

The spec says every AI output is checked by a cheaper pass. In `f7-drafts.ts` the cheap
pass starts with checks that need no model at all: unfilled placeholders, and money in
the copy that does not match the deal's fee. The model is asked about the things only a
model can judge — invented facts, tone, a claim not in the record.

This is cheaper, but the real reason is that it still works when the model call fails. A
checker that goes quiet during an outage is worse than no checker, because the badge
still says "checked".

### `SEND_ON_APPROVE` exists and defaults to off

Approving a draft writes a Gmail draft attributed to the approver; a person still presses
send in their own mail client. The flag to send directly exists because some install will
eventually want it, and it is better as a documented switch than a fork. It is off, and
the README says why.

### Stage guards live in the packet, not the API route

`guardStage()` reads from `STAGE_PACKETS`, so "a deal cannot enter Pre-Event unsigned" is
data next to the tasks and drafts that stage creates. Adding a guard to another stage is
a two-line edit in one file, and the API route needs no knowledge of it.

### One accent, held to

Paper-ink's rule is one accent colour, and the token map keeps it: stage chips and
semantic colours exist as tokens, but the interface uses LEDs and hairlines rather than
colour fills. `npm run lint:tokens` enforces that no component can reach for a hex at
all. An admin can still recolour every token from Settings → Appearance, with a contrast
warning below 4.5:1 that warns rather than blocks.

---

## Known gaps

Stated plainly rather than discovered later. See ARCHITECTURE §8 for the reasoning.

- **F11 has no upload UI** — CLI only, with a dry-run report.
- **F9 does not regenerate Docs or Sheets yet** — Calendar and Drive folders push;
  the document mirror is stubbed at the sweep.
- **The Opus weekly pipeline review is not scheduled** — the tier and task type exist.
- **No automated test suite.** The build is typechecked, linted and exercised end to end
  by hand (stage transitions, guards, proposals, payments, exports, workers). Tests
  belong on `f4-change-handler`, `f6-timers` and `forecast` first — they are pure
  functions with real rules, which is exactly where tests pay.
