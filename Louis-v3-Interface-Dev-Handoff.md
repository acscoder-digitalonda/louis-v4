# LOUIS v3 — Interface Design & Dev Handoff
### Everything the developer needs to start tomorrow
*Companion to `Louis-v3-Rebuild-Spec.md` (functions F1–F13) and `Louis-v3-Data-Holding-Map.md` (schema). Those two docs are the what; this one is the how-it-looks, how-it's-built, and in-what-order.*

---

# 1. DESIGN DIRECTION

**Feel:** modern, friendly, minimal — the calm confidence of a world-class SV product (think Linear / Notion / Attio-grade polish). Generous whitespace, one typeface family, no ornament, motion only where it communicates (150–200ms ease transitions, nothing bouncy). Every screen answers one question; nothing competes for attention.

**Relationship to paper-ink:** the existing paper-ink system (warm off-white, near-black ink — see `mockups/paper-ink-css-notes.md`) becomes the **default Light theme**. It is not discarded; it is tokenized. Dark theme is derived from the same token map. All of it lives behind CSS variables so themes and accents are data, not code.

**Rules of the road:**
- Tabs, not scrolls — no screen requires scrolling past more than one viewport to find a section (see §3).
- Everything editable in place — reading view and editing view are the same view (see §4).
- Keyboard-first on desktop (⌘K search, `E` to edit, `esc` to cancel), thumb-first on mobile.
- Empty states teach: every empty tab says what will appear there and which automation fills it.
- Loading = skeletons, never spinners on full screens.

---

# 2. THEMING SYSTEM (dark/light + hex-editable accents)

## 2.1 Mechanics
- Every color in the app is a CSS custom property. **Zero hardcoded hex in components** — lint rule enforces it (`stylelint` custom rule or grep in CI).
- Two theme maps (`light`, `dark`) shipped as defaults; user preference stored per-user (`Settings → Appearance → Light / Dark / System`), applied via `data-theme` attribute, respects `prefers-color-scheme` when "System."
- **Accent overrides:** Settings (admin) exposes a hex input for every non-background token below. Values stored in the `Settings/Theme` record in Airtable → fetched at app load → injected as CSS vars → live-preview on change, Save persists. Per-theme overrides (a hex can differ between light and dark) with a "use same for both" default.
- Contrast guard: on save, compute WCAG contrast of each accent against its background; warn below 4.5:1 (allow override with warning badge — friendly, not blocking).

## 2.2 The token map (every non-background color, hex-editable)

```
TEXT            --text-primary  --text-secondary  --text-muted  --text-inverse
ACCENT          --accent        --accent-hover    --accent-subtle (10% tint)
LINKS           --link          --link-hover
SEMANTIC        --success       --warning         --danger      --info
FOCUS           --focus-ring
BORDERS/LINES   --border        --border-strong   --divider
STAGE CHIPS     --stage-inquiry --stage-sales --stage-closedwon
                --stage-preevent --stage-delivered --stage-debriefed --stage-dormant
STATUS CHIPS    --chip-paid     --chip-pending    --chip-overdue
                --chip-contract-signed  --chip-contract-out
DATA VIZ        --chart-1 … --chart-6   (forecast bars, pipeline charts)
NOTIFICATION    --badge         (the bell dot)
```
Backgrounds (`--bg`, `--bg-raised`, `--bg-sunken`, `--bg-overlay`) exist as tokens too but are theme-owned, not user-editable — that's what keeps arbitrary accents from breaking the design.

---

# 3. INFORMATION ARCHITECTURE — tabs over sections

## 3.1 App shell
```
┌──────────────────────────────────────────────────────────┐
│ [LOGO Louis]  Pipeline  Deals  CRM  Journal  Money  ⌘K 🔔 ⚙ │  ← top bar (desktop)
└──────────────────────────────────────────────────────────┘
```
- **Logo → always routes home (Pipeline).** Non-negotiable, every screen.
- Top-level tabs: **Pipeline · Deals · CRM · Journal · Money · Review Queue** (Review Queue shows a count badge; it's Liezel's home — her default landing page is a per-user setting).
- Right cluster: global search (⌘K), notification bell, settings gear.
- **Mobile:** top bar collapses to logo + search + bell; primary nav becomes a **bottom tab bar** (Pipeline · Deals · Queue · More). "More" sheet holds CRM/Journal/Money/Settings.

## 3.2 The Deal record — tabs replace the 9 long sections
```
McKee Foods — Jul 17                     [Stage: Pre-Event ▾]  [⋯]
─────────────────────────────────────────────────────────────
 Overview │ Sales │ Logistics │ Questionnaire │ Assets │ Journal │ Money │ Activity
```
| Tab | Contents (mapped from the old 9 sections) |
|---|---|
| **Overview** | stage strip (mini pipeline), event essentials (date/location/AV/stage time), next tasks, kickoff notes, onsite contact card |
| **Sales** | fees (list/negotiated), decision date, proposal status, follow-up timers state, linked drafts |
| **Logistics** | pending-details checklist, hotel/travel, red-alert indicator |
| **Questionnaire** | Q-fields + received flag; empty state links the public form |
| **Assets** | Drive folder tree (Received/Sent/Decks), contract & client files — references, opens Drive |
| **Journal** | the sidecar strip + linked orders |
| **Money** | payment/contract chips (lookups); amounts respect role toggle |
| **Activity** | audit log + emails + sent drafts, newest first — the deal's whole story |

- Tab state in URL (`/deals/rec123?tab=logistics`) — shareable, back-button-safe.
- Mobile: tabs become a horizontally swipeable segmented bar, same order.
- Stage changes via the header dropdown fire the F5 packet; confirm-dialog only when skipping stages.

## 3.3 Other screens
- **Pipeline (home):** kanban board, six columns + collapsed Dormant; cards show client, date, fee (role-gated), next-task chip. Drag between columns = stage change (with packet confirmation). Mobile: columns become a stage-filtered list with a segmented control.
- **CRM:** two views (Bureau Agents / Direct Buyers) over one Contacts table + Clients list; person page shows linked deals across years.
- **Review Queue:** two lists — Drafts to approve, Field-change proposals (old→new diff, source email link). One-tap Accept / Edit / Dismiss. This screen is optimized for mobile first — it's the on-the-road approval surface.
- **Money:** Owed/Paid/Weighted tiles + payments ledger (role-gated); accountant sees only the published Airtable Money interface, never this app.
- **Settings:** Appearance (theme + accent hexes) · Users & roles · Notifications (per-user rules) · AI (backend switch, tier map, **usage meter** §7) · Mirror status · Import/Export.

---

# 4. EDITABILITY

- **Click-to-edit everywhere:** text fields become inputs on click, save on blur/Enter, `esc` cancels. Optimistic UI with rollback toast on API failure.
- Selects render as the colored chips (stage, statuses) — click opens the option menu.
- Every write → Airtable REST API **by field ID** → Audit Log entry (user, field, old→new).
- Role-gating server-side: the API route checks role before writing; the UI merely hides what the route would refuse.
- Read-only fields (lookups, chips from Money, audit entries) get a subtle lock affordance on hover — teach, don't frustrate.
- Concurrent edits: last-write-wins with a "field updated by Liezel just now" toast if a stale write is rejected (compare Last Modified).

# 5. SEARCH (⌘K)

- **Global command palette:** ⌘K (desktop) / search icon (mobile). Searches Deals, Clients, Contacts, Journal Orders, and Drafts in one ranked list, grouped by type; Enter jumps to record, tab filters by type.
- **Implementation (middle-path honest):** Airtable's API has no good search endpoint. The app keeps a lightweight **server-side cache** (SWR-refreshed, ~every 60s + on-write invalidation) of searchable fields (names, companies, emails, locations, dates) and runs fuzzy matching (Fuse.js) over it. At this volume (hundreds–low thousands of records) this is instant and avoids new infrastructure. If the base grows 10×, swap the cache for a real index later — isolated behind one `search()` function.
- Also searches **actions**: typing "settings", "import", "new deal" surfaces navigation/commands — palette, not just finder.

# 6. MOBILE

- Responsive breakpoints: ≥1024 desktop (top nav) · 640–1024 tablet (top nav, denser) · <640 mobile (bottom tabs).
- **PWA:** manifest + service worker (cache shell, not data) → installable on Ben's phone; the Review Queue and Pipeline are the two screens tuned hardest for mobile.
- Touch targets ≥44px; swipe on queue items (right = accept, left = dismiss, with undo toast).
- No feature is desktop-only except Settings→AI/theme admin (usable but not optimized).

---

# 7. AI RUNTIME IN THE UI — backend switch + cost meter

## 7.1 The switch (Settings → AI)
- `AI_BACKEND` surfaced as a Settings control: **Claude Code (local runner)** ⇄ **OpenRouter** — flipping writes the env/config the workers read. Phase 0 ships with Claude Code active; the OpenRouter fields (API key, per-tier model IDs, fallback provider) exist from day one, greyed until filled.
- Tier map editable: task type → model per backend (defaults: classify/check=haiku, extract/draft=sonnet, escalate=opus; OpenRouter equivalents once flipped).

## 7.2 Token/cost counter (build in Phase 0, day one)
- **`Usage Log` table (Airtable):** timestamp · worker(F#) · task · model · tokens-in · tokens-out · est-cost · backend · deal-link(optional) · duration · ok/err.
- **Phase 0 capture:** every wrapper runs `claude -p … --output-format json`; the JSON result includes usage/cost fields — the wrapper parses and POSTs a Usage Log row after every call. Non-zero exit or unparseable output logs an `err` row (never silent).
- **OpenRouter capture:** usage returned in each API response; same row shape, plus a daily credits-remaining check.
- **Settings → AI → Usage meter:** today / 7-day / 30-day totals; cost by tier and by worker (bar); calls + error rate; **monthly cap** (admin-set) with an 80% warning banner and a defined cap-hit behavior: pause non-critical workers (research, QA sweep) while intake/timers continue.
- Phase 0 nuance shown honestly in the meter: subscription runs show *estimated equivalent* cost (labeled "est. — covered by Max plan") so you learn the real burn rate before the flip.

# 8. NOTIFICATIONS — in-app + auto email

- **Fanout:** every Notification record → bell (in-app) + **email** (via the Gmail API service address) per user preference matrix (Settings → Notifications: rows = event types, columns = In-app / Email / Off).
- **Event types (initial set):**
  - `review-item` — new draft or field-change proposal (digest-able: immediate or hourly batch)
  - `red-alert` — logistics incomplete at T-12; stale hold; decision-date passed with no reply
  - `worker-failure` — any wrapper non-zero exit, extraction error, mirror push failure → **always emails admin immediately, not batchable**
  - `payment-confirmed` / `contract-signed`
  - `cap-warning` — usage at 80% / cap hit
  - `qa-digest` — F13 morning report
- Failure emails include the log tail and the worker name — actionable, not "something broke."
- All emails internal-only (team addresses). Client-facing mail remains exclusively human-sent drafts — notifications never leak outward.

---

# 9. TECH STACK & GIT BEST PRACTICE (non-negotiables for the dev)

**Stack:** Next.js (App Router) + TypeScript strict · Tailwind (tokens mapped to the CSS vars — no raw hex in classes) · Airtable REST via a thin typed client bound to **field IDs** (generated `fields.ts` constants file — never string names in components) · Auth: Google SSO (NextAuth) + allowlist table · Deployed on Vercel.

**Auth & allowlist (initial):** Google SSO is the **only** sign-in — no username/password path, ever (Google provides MFA/session security; passwords are surface area we refuse to own). Allowlist seeds with **two admins from day one**: `jordan@bennemtin.com` and `acscoder@digitalonda.com` — two admins so a single locked-out Google account never strands admin access. Ben and Liezel are added as `owner` and `ops` when onboarded. **Break-glass path:** the allowlist is a plain Airtable table, editable directly in the base — if app auth ever misbehaves, an admin fixes the list in Airtable, not in the app. The accountant never logs into the app (published Airtable Money interface only).

**Repo & workflow:**
1. Repo `louis` on GitHub. `main` protected: no direct pushes, PR required, 1 review (Jordan or Regan), CI green required.
2. Trunk-based: short-lived feature branches (`feat/deal-tabs`, `fix/queue-swipe`), merged small and often. No long-running branches.
3. **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`) — enables changelog + semantic versioning later.
4. CI on every PR (GitHub Actions): typecheck · ESLint · Prettier check · build · the no-hardcoded-hex lint. Vercel preview deploy per PR — review the actual UI, not screenshots.
5. Secrets: `.env.example` committed with every var documented; real values only in Vercel env + local `.env.local` (gitignored). **No key ever in the repo, ever in Airtable fields.**
6. `README.md` = run-it-locally in 5 steps; `ARCHITECTURE.md` links the three spec docs; `CHANGELOG.md` from day one.
7. Workers live in the same repo under `/workers` (shared types with the app), each runnable standalone; wrapper shell scripts under `/workers/phase0/`.
8. Definition of done per PR: works on mobile viewport, both themes, keyboard accessible, writes audited, no console errors.

# 10. BUILD ORDER (hand this list to the dev as the sprint plan)

1. **Day 1–2 — Skeleton:** repo + CI + Vercel + SSO/allowlist + app shell (top bar, logo-home, bottom tabs, theme toggle with default tokens).
2. **Deal record with tabs** + inline editing + audit writes (the core loop). Pipeline board next.
3. **Review Queue** (mobile-first) + Notifications (bell + email fanout + failure emails).
4. **⌘K search** (cache + Fuse) · Settings: Appearance (accent hex editor + contrast guard), Users.
5. **Phase 0 runtime:** wrapper scripts + Usage Log capture + Settings meter + `AI_BACKEND` switch scaffold (OpenRouter fields present, inert).
6. **Workers wired** in spec order: F5 stage engine → F6 timers → F1 form intake → F7 drafts → F2 email intake → F4 change handler → F3 research → F9 mirror → F13 QA.
7. **Money group migration** (Cash base records in, lookups live, retire old base) · CRM screens · Journal sidecar UI · Import/Export (F11/F12 incl. HubSpot profile).
8. **Flip rehearsal:** with OpenRouter key in place, flip the backend in staging, run the worker suite, compare Usage Log — prove the one-afternoon migration before you need it.

---
*Hand to dev with: `Louis-v3-Rebuild-Spec.md` · `Louis-v3-Data-Holding-Map.md` · `mockups/paper-ink-css-notes.md` · the FigJam board (5 diagrams). Questions land in the repo as GitHub issues, not in chat.*
