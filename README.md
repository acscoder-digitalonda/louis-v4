# Louis v3

**A deal moves through six stages. Every time it changes stage (or a timer fires, or money moves), the system drafts the next thing. A human clicks send.**

Airtable is the database. This app is a skin over it, and the workers talk to Airtable
directly — so if this app is down, nothing stops.

---

## Run it locally in five steps

```bash
cd louis-v3
npm install
cp .env.example .env.local     # optional — it runs without any of it
npm run dev
open http://localhost:3000
```

With no credentials you get **mock data and demo auth**: every screen is clickable, the
workers are runnable, and CI needs no secrets. Fill in `.env.local` to point at the real
base and turn on Google SSO. Demo mode refuses to start in production.

### Connecting a real base

```bash
# 1. Put AIRTABLE_API_KEY + AIRTABLE_BASE_ID in .env.local
npm run base:bootstrap            # dry run — prints what it would create
npm run base:bootstrap -- --apply # create the tables and fields
npm run fields:refresh            # bind the app to field IDs, not names
```

`base:bootstrap` leaves rollups and lookups (Payment Status, Contract Status) for a human
— they depend on decisions a script should not make.

### Running a worker

```bash
npm run worker                    # list them
npm run worker f6-timers          # run one
npm run worker f11-import -- old-deals.csv          # dry run
npm run worker f11-import -- old-deals.csv --commit # write it
```

The same functions are also reachable at `/api/cron/<name>` with `CRON_SECRET`. One
implementation, two entry points.

**Scheduling lives on the VPS, not on Vercel** — see [`SCHEDULING.md`](./SCHEDULING.md).
Vercel Cron is unused (the Hobby plan caps it at daily, and F2 needs every 15 minutes),
and putting the clock on the VPS keeps intake running when the app is mid-deploy.

### Before you push

```bash
npm run ci    # typecheck · eslint · no-hardcoded-colour · build
```

---

## What is where

```
speaker.config.ts      every speaker-specific value in the system — the white-label seam
src/lib/theme.ts       the token registry; the ONE file allowed to contain a colour
src/lib/airtable/      schema (base template) + field-ID binding + REST client
src/lib/data/          the data seam: one interface, an Airtable impl and a mock
src/lib/gateway/       AI: tier routing, fallback, usage log, monthly cap
src/lib/stages.ts      stage packets — what F5 fires, and what the mini pipeline renders
src/lib/templates.ts   the script bank (Airtable's Templates table wins in production)
src/workers/           F1–F13, each runnable standalone
src/app/               the screens and API routes
scripts/               base bootstrap · field refresh · the no-hex lint
```

## The rules this codebase enforces rather than documents

- **Nothing client-facing sends itself.** The only exception is the inquiry
  acknowledgement, and it is marked `autoSend` in one place you can grep for.
- **Automation never overwrites a human silently.** Empty field → fill and log.
  Conflicting value → a Proposal in the Review Queue with the source email attached.
- **Money owns its own fields.** Payment and Contract status are lookups; the API refuses
  to write them, whoever asks.
- **A deal cannot enter Pre-Event unsigned.** The guard lives in the stage packet.
- **Every model call is checked by a cheaper one**, and logged — successes and failures.
- **Colour is data.** `npm run lint:tokens` fails the build if a hex appears outside the
  token registry.
- **Google SSO only.** There is no password path and none should ever be added.

---

## The specs

Read in this order — they are the *what*; this repo is the *how*.

1. [`Louis-v3-Interface-Dev-Handoff.md`](./Louis-v3-Interface-Dev-Handoff.md) — design
   direction, theming, tab IA, editability, search, mobile, AI runtime + cost meter,
   notifications, Git rules. §10 is the build order.
2. [`Louis-v3-Rebuild-Spec.md`](./Louis-v3-Rebuild-Spec.md) — the function map (F1–F13):
   every worker, trigger, output, human gate and model tier.
3. [`Louis-v3-Data-Holding-Map.md`](./Louis-v3-Data-Holding-Map.md) — the schema in five
   domains, the Drive structure, and the export formats.

[`ARCHITECTURE.md`](./ARCHITECTURE.md) maps those docs onto the code.
[`DECISIONS.md`](./DECISIONS.md) answers the spec's open questions and records what was
decided in code.

`/reference` is supporting context, not spec: the canonical pipeline model, Connor's
sales process and script bank, and the paper-ink design notes that became the default
light theme.

**Not in this repo, and never should be:** Airtable credentials, the Google Cloud
project, any API key.
