# Changelog

Conventional Commits feed this file. Dates are the day the work landed.

## [3.0.0] — 2026-08-15

Ground-up rebuild. No code carried over from the earlier test build.

### Added — spine & shell
- Next.js App Router + TypeScript strict, Tailwind bound to CSS custom properties.
- Paper-ink tokenised as the default light theme, with a derived dark theme and a
  three-state toggle (light / dark / system).
- App shell: logo→home on every screen, top nav on desktop, bottom tab bar + "More"
  sheet on mobile, PWA manifest.
- Google SSO (NextAuth) with the Airtable Users table as the allowlist, seeded from
  `speaker.config`. Demo mode when SSO is unconfigured; refused in production.
- Role-based access control enforced server-side in every API route.

### Added — screens
- Pipeline board: six columns + collapsed Dormant, drag-to-change-stage with skip
  confirmation, mobile segmented list.
- Deal record with eight tabs, URL-addressable, click-to-edit everywhere, optimistic
  writes with rollback, stale-write detection, and a lock affordance on read-only fields.
- Review Queue, mobile-first: drafts and field-change proposals, swipe to accept or
  dismiss, undo toast, inline editing before approval.
- CRM (bureau agents / direct buyers / companies), Journal sidecar, Money (owed / paid /
  weighted, proposed-match confirmation), Settings (appearance, users, AI, mirror, data).
- ⌘K command palette over a cached fuzzy index of records *and* commands.
- Notification bell with in-app + email fanout and a per-user preference matrix.

### Added — data layer
- One data interface with two implementations: Airtable and an in-memory mock, so the
  app and CI run with zero credentials.
- Airtable schema as code, doubling as the white-label base template.
- Field-**ID** binding via `fields:refresh`, with graceful fallback to field names.
- `base:bootstrap` to create a speaker's base from the schema.

### Added — workers
- F1 form intake (public endpoint, honeypot, shared-token guard).
- F2 email intake: Gmail poll, Haiku classification, Sonnet extraction, key-agent forward.
- F3 research agent with a source-verification checker and Opus escalation.
- F4 change handler: silent fill on empty, human-approved proposal on conflict.
- F5 stage engine with declarative stage packets and the unsigned-contract gate.
- F6 timers: soft check-in, forcing email, stale hold, questionnaire chase, T-12 red
  alert, journal nudge.
- F7 drafts engine with a deterministic-then-model checker pass.
- F9 Google mirror (Calendar + Drive folder tree) with Mirror State and integrity check.
- F11 import with HubSpot detection, dry-run diff and dedupe candidates.
- F12 export: native CSV plus the HubSpot-standard profile, round-trippable by record ID.
- F13 nightly QA sweep with a written digest.
- Every worker runnable from the CLI and from `/api/cron/<name>`.

### Added — AI runtime
- Gateway with tier routing, retry, same-tier fallback to a second provider, and a
  monthly cap that pauses research and QA while intake and timers continue.
- `claude-code` and `openrouter` transports, switchable from Settings.
- Usage Log row per call — successes and failures — behind a cost meter with per-tier and
  per-worker breakdowns.

### Deployed
- Vercel project `louis-v3` (team-digitalonda), production alias
  <https://louis-v3.vercel.app>. Credentials carried over from the v2 `louis` app.
- Airtable base `app5In2fKegyPm4sU` ("Louis v3") created in workspace
  `wspEfkM1os9gHGgVW`, bootstrapped with all 18 tables and bound by field ID.
- v2 data migrated: 16 deals, 16 clients, 17 contacts, 11 payments, 18 schedule legs.
  The v2 bases were read-only throughout and are untouched.
- Vercel Cron removed; scheduling moves to the VPS (`SCHEDULING.md`).

### Added — migration tooling
- `base:create` — creates a v3 base in a workspace (white-label step one).
- `migrate:v2` — v2 → v3 with a dry-run report. Maps the four-value `Status` onto the
  seven stages, splits the nine repeated journal fields into `Journal Orders` rows, and
  joins the Cash base on `Source Deal ID` to re-point money at the new deals.
- `repair:stages` — fixes select values written as domain keys instead of labels.

### Fixed
- `bootstrap-base` survives field types the Meta API refuses (`createdTime`,
  `lastModifiedTime`), promotes a primary-safe field to the front of each new table, and
  gives checkboxes the icon/colour options Airtable requires.
- `migrate:v2` writes select values as labels. `typecast: true` does not reject an
  unknown option — it silently creates one, which had polluted `Deals.Stage` with five
  lowercase duplicates.

### Added — engineering
- CI: typecheck, ESLint, the no-hardcoded-colour lint, and a credential-free build.
- `.env.example` documenting every variable.
- `ARCHITECTURE.md`, `DECISIONS.md`.
