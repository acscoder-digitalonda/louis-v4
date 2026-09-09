# Louis

**A deal moves through eight stages. Every time it changes stage — or a timer fires, or
money moves — the system drafts the next thing. A human clicks send.**

Airtable is the database. This app is a skin over it, and the workers talk to Airtable
directly — so if the app is down, nothing stops. Airtable bills per *request*, not per
record, and most of what is unusual in this codebase follows from that.

---

## Run it locally

```bash
npm install
cp .env.example .env.local     # optional — it runs without any of it
npm run dev
open http://localhost:3000
```

With no credentials you get **mock data and demo auth**: every screen is clickable, the
workers are runnable, and the test suite needs no secrets. Fill in `.env.local` to point
at the real base and turn on Google SSO. Demo mode refuses to start in production.

### Connecting a real base

```bash
npm run base:bootstrap             # dry run — prints what it would create
npm run base:bootstrap -- --apply  # create missing tables
npm run schema:sync -- --apply     # add missing fields to existing tables (additive only)
npm run fields:refresh             # bind the app to field IDs, not names
```

Airtable's API cannot create formula, rollup or modified-time fields, or add an option
to a select. `schema:sync` reports those instead of pretending; a person builds them in
the Airtable UI. The one that matters is **Deals → Last Modified** (type *Last modified
time*, all editable fields): without it, stale-write detection cannot fire and two people
editing one deal overwrite each other silently. The formula fields (`Next Action Owner`,
`Line Total`, `Add-On Amount`, `Amount`, `Weekend Event`) are for Airtable's own views;
the app computes every one of them itself.

Seeds, all dry-run by default and reversible by batch:

```bash
npm run seed:templates        # the 31-template email library (E01–E24)
npm run seed:pricing          # rate cards + products
npm run seed:proof            # testimonials, past clients by industry, bureau companies
npm run seed:mail-accounts    # which mailboxes intake sweeps, and how much of each
npm run enrich:companies -- --fetch --apply   # industry / address / logo from each company's own site
```

### Running a worker

```bash
npm run worker                    # list them
npm run worker f6-timers          # run one
```

The same functions are reachable at `/api/cron/<name>` with `CRON_SECRET` as a bearer
token. One implementation, two entry points — "it works on the schedule" and "it works
when I run it" are the same claim.

**Scheduling lives on the VPS, not on Vercel.** `npm run schedule -- --write` renders
`deploy/louis.crontab` from the worker registry; install it with the command in its
header. Six workers: intake and the reply clock hourly, the calendar mirror hourly, and
timers, research and the QA sweep once a day, on the speaker's timezone. Vercel Cron is
unused — Hobby caps it at daily — and a test fails if the committed crontab drifts from
the registry. See [`SCHEDULING.md`](./SCHEDULING.md).

### Testing against the live product

```bash
npm run cleanup:test              # dry run: every deal whose name starts with "TEST "
npm run cleanup:test -- --apply   # remove them and everything hanging off them
npm run prune:derived -- --apply  # drop stale mirror rows and duplicate emails
```

A walkthrough that takes one fake deal from a website submission to Debriefed, with what
to expect at each step, is in the handoff. Name test deals `TEST …` and the cleanup can
never touch a real booking.

### Ship

```bash
npm run ship          # CI → push to main → wait for Vercel → check the alias
npm run ship -- --dry # CI only
```

Deploys go through the Vercel GitHub integration: **a push to `main` is the deploy.**
`ship` keeps two guarantees the integration does not — the full test suite runs before
the push, with a real exit code, and the commit author is an email Vercel can match to a
GitHub account. Never commit with `-c user.email=…`; Vercel blocks the deployment and
says nothing until you look.

```bash
npm run ci    # typecheck · eslint · no-hardcoded-colour · 600 tests · build
```

---

## Production environment

The variables that bit us, and what breaks without each:

| Variable | Without it |
|---|---|
| `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` | mock provider, with a warning nobody reads |
| `CRON_SECRET` | every worker endpoint is 403 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | no Gmail, no calendar, no Drive |
| `GMAIL_SERVICE_ADDRESS` | the mailer logs instead of sending; nobody receives anything |
| `INTAKE_MAILBOXES` | fallback only — the Mail Accounts table is the source of truth |
| `GOOGLE_MIRROR_SUBJECT` | the mirror impersonates nobody and gets a 404 from Google |
| `GOOGLE_CALENDAR_ID` | the mirror refuses to write, rather than writing to somebody's own diary |
| `GOOGLE_DRIVE_DEALS_FOLDER_ID` | Drive mirror fails per deal |
| `OPENROUTER_API_KEY` | no model calls |
| `FORM_INTAKE_TOKEN` | the website form endpoint is open to anyone — set it together with the site |

Changing a variable requires a redeploy; the running deployment keeps the old value.
`vercel env pull` returns blanks for encrypted values — it is not a way to check them.

---

## MCP

`/api/mcp` is a streamable-HTTP MCP server: 12 tools, admin role only, no tool that
writes money, every write batch-reversible.

```bash
npm run mcp:token -- --issue --for=<email> --label="…"   # shown once, stored as a hash
npm run mcp:token -- --list
npm run mcp:token -- --revoke=<record id>
```

What it can do and how to ask is in the MCP guide in the handoff.

---

## What is where

```
speaker.config.ts      every speaker-specific value — stages, deal types, timezone, the white-label seam
src/lib/airtable/      schema · field-ID binding · REST client with a 5/s window · read-through cache
src/lib/data/          the data seam: one interface, an Airtable impl and a mock
src/lib/gateway/       AI: tier routing, failover, usage log, monthly cap, mode dial
src/lib/stages.ts      stage packets, guards, isLive — what F5 fires and what the board renders
src/lib/templates.ts   the shipped script bank, and the join to the E-numbered library
src/lib/intake/        mail accounts, dedupe, what counts as our own mail
src/lib/mcp/           tokens, tools, the JSON-RPC server
src/lib/*.ts           the engines: pricing · followup · digest · conflicts · sla · capacity · kit · coaching · …
src/workers/           F1–F14 and the C-series seeds, each runnable standalone
src/app/               the screens and API routes
src/middleware.ts      stamps a browser after every write so its next reads skip the cache
deploy/                the generated crontab and a GitHub Actions fallback
scripts/               seeds · repairs · backups · cleanup — dry-run by default
```

## The rules this codebase enforces rather than documents

- **Nothing client-facing sends itself.** The one exception is the inquiry
  acknowledgement, marked `autoSend` in one place you can grep for — and a test pins that
  branch to `sendMail`, because it once created a Gmail draft and recorded it as sent.
- **Every AI write is a proposal.** The change handler has no silent-fill exception;
  `silentWrites: never[]` is kept in the shape so a reader sees the rule.
- **Live means `isLive`, not `!isTerminal`.** Seven years of imported history sits at
  Delivered, which is not terminal. Four places got that wrong independently.
- **A field the schema declares, an encoder writes.** A test reads the encoders and fails
  otherwise — fifteen deal fields were once decoded and never written, and nothing threw.
- **Money stays with the office.** Contract and billing status are set by ops/admin; the
  owner role edits notes and stage. No MCP tool touches Payments, and a test enforces it.
- **A deal cannot enter Pre-Event unsigned.** The guard lives in the stage packet.
- **Deals are closed, never deleted.** `junk` is a closed-lost reason that leaves the
  board and is never re-engaged; changing the stage brings it back.
- **You see your own writes.** The read cache is per instance; a cookie stamps the
  browser that wrote, and its next reads load fresh whichever instance serves them.
- **The public endpoints cannot page anyone.** A bad form submission is a 400; a wrong
  cron token is a log line. Failure email is for our own failures, damped to one per six
  hours per cause.
- **Colour is data.** `npm run lint:tokens` fails the build on a hex outside the registry.
- **Google SSO only.** There is no password path and none should be added.

---

## The specs

The add-on package is the current *what*; the v3 documents are the base it extends.

1. `Louis-AddOn-Handoff-Package/` — run plan, decisions log, gap analysis, the email
   template library, and the seeds.
2. [`Louis-v3-Rebuild-Spec.md`](./Louis-v3-Rebuild-Spec.md) — the function map (F1–F13).
3. [`Louis-v3-Data-Holding-Map.md`](./Louis-v3-Data-Holding-Map.md) — the schema in five
   domains.
4. [`Louis-v3-Interface-Dev-Handoff.md`](./Louis-v3-Interface-Dev-Handoff.md) — design
   direction, theming, tab IA.

[`ARCHITECTURE.md`](./ARCHITECTURE.md) maps those onto the code. [`DECISIONS.md`](./DECISIONS.md)
records what was decided in code. [`CHANGELOG.md`](./CHANGELOG.md) is the history.

**Not in this repo, and never should be:** Airtable credentials, the Google Cloud
project, any API key, any token.
