# LOUIS v3 — Rebuild Spec: Data Map, Function Map & All Movement
### Written for two readers: Jordan (decisions) and the build agent (instructions)
*Supersedes and extends `Louis-App-Spec.md` + `Louis-Pipeline-Canonical-v2.md`. Locked decisions from `HANDOFF-Fable-Architect.md` carry forward unless overridden here.*

---

# 0. THE ONE-SENTENCE MODEL (unchanged)

**A deal moves through six stages. Every time it changes stage (or a timer fires, or money moves), the system drafts the next thing. A human clicks send.**

v3 adds: the sales pipeline *upstream* of the existing Event Hub, a real UI shell (Vercel/paper-ink with Airtable fallback), users/permissions/notifications, a tiered agent team with QA, and a white-label kit so this whole install can be stamped out for other speakers.

---

# 1. WHAT WE KEEP vs. WHAT CHANGES

**Keep (already built, do not rebuild):**
- Airtable base `appNAaHVJMeTMbzdh` (Louis — Event Hub) as the data layer. **Changed decision (deliberate override, 14 Aug 2026):** the Cash base `appOXgMU40vanIiDG` is **merged into the Louis base** as a Money table group (Payments, Schedule Legs) — migrate its records in, then retire the separate base. Separation is now by permission (accountant = interface-only share; Ben = chips-toggle), not by base.
- The middle-path architecture: Airtable backend → paper-ink Next.js front-end on Vercel reading via REST API, bound to **field IDs not names**.
- Google mirror as redundancy-first (Calendar / Docs / Sheets / Drive), one-way, app→Google.
- Human-in-the-loop rules: no client-facing send without a human; payments human-confirmed only; AI writes are proposals except where explicitly whitelisted.
- Separate installs, Google SSO + allowlist, paper-ink design tokens.

**Change / add in v3:**
1. **Pipeline upstream of the Event Hub** — the deal record now begins at Inquiry, not at Closed-Won. Same record, whole life.
2. **UI shell requirements** — logo→home, inline editing, notifications, roles.
3. **AI runtime** — API-billed (not consumer subscription), cron-scheduled workers, OpenRouter gateway with model-tier routing and automatic fallback, and a checker pass on all output.
4. **Import/Export/Process** — old projects in, everything out, always.
5. **Macro + mini pipeline views.**
6. **White-label kit** — the whole system as a reproducible template.

---

# 2. DATA MAP

## 2.1 Entities (Airtable tables — extend the existing base)

```
DEAL (extends Events — the core object, highest order of truth)
├─ identity: Deal Name, Client(link), Source(direct|bureau), Bureau Agent(link)
├─ stage: Stage(Inquiry|Sales|Closed-Won|Pre-Event|Delivered|Debriefed|Dormant)
├─ sales: Decision Date, List Fee, Negotiated Fee, Proposal Sent(✓), Hold Date(s)
├─ event: Location, Event Date, AV Check, Stage Time, URLs   (existing 9 sections)
├─ money chips: Payment Status, Contract Status              (read-only from Cash)
├─ meta: Created, Last Modified(per-group), Owner, Deal Type
└─ links: Contacts(1→n), Logistics Items(1→n), Journal Orders(1→n),
          Emails(1→n), Drafts(1→n), Tasks(1→n), Audit Log(1→n)

CLIENT            company; 1→n Deals (existing)
CONTACT           person; typed: bureau-agent | meeting-planner | decision-maker |
                  onsite (existing table, add Type field)
JOURNAL ORDER     sidecar pipeline: Mentioned→Promo Sent→Received→Interested→
                  Bulk Ordered→Shipped→Dropship; qty, ship-by date, warehouse notes
EMAIL             ingested message: from, to, thread-id, date, body-ref(Drive),
                  extraction-status, linked Deal — the raw material, never edited
DRAFT             system-written outbound: type(ack|proposal|follow-up|forcing|kit|
                  journal|debrief), body, status(proposed|approved|sent|dismissed),
                  approver, sent-at — THE review queue
TASK              human to-do: assignee, due, source(stage-packet|timer|manual), done
NOTIFICATION      in-app + email fanout: user, event-type, read, link
USER              email, role(owner|admin|ops|accountant), allowlist entry
AUDIT LOG         every AI/automation write: who(agent), what(field, old→new),
                  when, source(email-id|form|timer), reversible(✓)
RESEARCH BRIEF    prep-doc per inquiry: company facts, MVV, budget signals,
                  LinkedIn/Crunchbase notes, model-used, checked-by
MIRROR STATE      per surface (Calendar|Doc|Sheet|Drive): entity, last-pushed, ok/err
SETTINGS          AI providers + tier map, notification prefs, speaker profile
```

**Design rule carried forward:** enums are single-selects (colored chips → paper-ink LEDs); times stay text with timezone; child tables over repeated fields; every record front-end-bound by field ID.

## 2.2 The two pipelines (macro + mini)

- **Macro pipeline** = the Deal's Stage field. One kanban/board view: six columns + Dormant. This is the "where is everything" screen — Ben's glance view.
- **Mini pipelines** = per-stage checklists rendered from the stage packet. Inside a deal, you see only the current stage's moves: e.g. Sales shows [hold placed ✓ · pitch call · proposal sent ✓ · decision date set · follow-up armed]. Pre-Event shows the logistics checklist + journal sidecar. Mini pipelines are **Tasks filtered by deal+stage**, not separate schemas — one mechanism, many small views.
- The journal sidecar renders as a mini pipeline strip on the deal from Pre-Event onward.

## 2.3 Forecast (formula fields, no new system)
Inquiry no-hold **$0** · Sales+hold **25%** · Sales+proposal-sent **65%** · Closed-Won+ **100%**. Cash reads these as its pipeline-weighted forecast; Owed/Paid stay in Cash.

---

# 3. FUNCTION MAP — every mover, its trigger, and its output

Format: **F# NAME** — trigger → action → writes → human gate → model tier.

## Intake & research
- **F1 FORM INTAKE** — website form submit → create Deal(Inquiry) + Contact → auto-ack Draft(type:ack, whitelisted auto-send) → notify ops. *No AI.*
- **F2 EMAIL INTAKE WORKER** — cron (every 15 min) on watched Gmail label/address → new message → Email record + Drive body copy → **Haiku** classifies (inquiry? update? noise?) → inquiry: create/attach Deal → **Sonnet** extracts fields → writes go to Review Queue as proposals (see F4) → key-agent list match ⇒ instant forward + notify Ben. *Gate: extraction proposals accepted by human; auto-ack is the only auto-send.*
- **F3 RESEARCH AGENT** — Deal enters Inquiry → **Sonnet** does cursory research (site, MVV, LinkedIn, Crunchbase, news) → Research Brief record + emailed to Ben → **Haiku** checker verifies every claim has a source link, flags anything unverifiable. *Escalate to **Opus** only if Sonnet self-reports low confidence or the client is flagged high-value.*
- **F4 EMAIL-CHANGE HANDLER** (the "updates/changes in emails" rule — see §7 Q1) — when F2 extracts a value for an **empty** field → silent write + Audit Log + "recent auto-updates" chip. When it extracts a value that **conflicts with an existing** field (new AV time, changed date, new fee) → NEVER silent: creates a Proposal (old→new, source email linked) in the Review Queue + notification to ops. Accept = write + audit; dismiss = logged.

## Pipeline engine
- **F5 STAGE ENGINE** — Stage field changes → fire that stage's packet: create Tasks, create Drafts, arm Timers, update forecast, mirror push. *Pure automation, no AI.*
- **F6 TIMERS** — daily cron sweep → decision-date passed +2d ⇒ soft check-in Draft (once) → +7d ⇒ forcing-email Draft → hold stale ⇒ ops notification → questionnaire unreturned T-14 ⇒ chase Draft → logistics incomplete T-12 ⇒ red-alert notification → journal promo-no-order T-35 ⇒ nudge Task. *No AI; templates from the script bank.*
- **F7 DRAFTS ENGINE** — any Draft created → **Sonnet** fills the template with deal context in Ben's voice → **Haiku** checker (names right? numbers match record? no hallucinated facts? tone pass?) → status:proposed → appears in Review Queue + Gmail Drafts (via API) → human edits/sends → status:sent + thread-id captured. *Client-facing = always gated. Opus only for high-stakes drafts (proposal to a flagged whale, sensitive recovery email).*

## Money & delivery
- **F8 MONEY MATCH (in-base — the cross-base seam is deleted)** — cash worker matches bank/QB events against invoice number + amount → proposes a Payment record → human confirms in the Money interface → Payment Status / Contract Status on the Deal are **lookups from the money tables** (no sync worker, live by definition). Stage cannot advance to Pre-Event until contract-signed lookup is green. Money tables writable only by the money group + confirming humans.
- **F9 MIRROR WORKER** — cron + on-change (debounced) → Calendar event (holds color-coded by stage), per-deal Google Doc regenerated, Sheets index row, Drive folder tree → Mirror State updated → weekly integrity check (counts match) → report notification. *No AI.*
- **F10 FIELD GUIDE / ROAD WARRIOR** — button on deal → digest email + calendar invite to Ben. *(existing, keep)*

## Data lifecycle
- **F11 IMPORT** — CSV/Sheet upload (old projects, the 5-year scrape) → mapping screen (source column → field ID, saved as reusable Mapping) → dry-run diff → **Haiku** normalizes (dates, names, dedupe candidates by email/phone/company+date) → human approves merge report → records created with source:import + audit. Two inquiries for the same event = dedupe candidate, human merges.
- **F12 EXPORT** — any view → CSV/Sheet on demand + the nightly full snapshot (F9), **plus a HubSpot-standard export profile**: `companies.csv` / `contacts.csv` / `deals.csv` with HubSpot header labels, dedupe keys (Company Domain Name, Email), ISO dates, semicolon multi-values, plain-number amounts, and an `Airtable Record ID` column for round-tripping. Six stages travel as a custom pipeline. Journal Orders as their own CSV. The mapping is stored two-way — F11 accepts raw HubSpot exports natively. Full column spec in `Louis-v3-Data-Holding-Map.md`. Everything is extractable at all times — the platform-exit guarantee. *Schema addition: Company Domain field on Clients (QA sweep flags missing).*
- **F13 QA SWEEP** — nightly **Haiku** pass: orphan records, deals with no next Task, stale Review Queue items >48h, mirror errors, broken links → morning digest notification to admin.

## Tier map (the Opus→Sonnet→Haiku rule, encoded)
| Tier | Used for | Never for |
|---|---|---|
| **Haiku** | classify, dedupe, normalize, checker passes, QA sweep | anything client-facing |
| **Sonnet** | extraction, research briefs, draft writing | final say on conflicts |
| **Opus** | high-value research escalation, sensitive drafts, weekly "read the whole pipeline and flag risks" review | routine volume |

Every AI output is **checked by a second, cheaper pass** (F3, F7, F13) before a human sees it — "the work and emails are checked" is structural, not aspirational.

---

# 4. UI SHELL REQUIREMENTS (Vercel / paper-ink front-end)

1. **Logo → home.** The name/logo in the top bar is always a link to the Dashboard. Every screen. (Trivial; written down so it ships.)
2. **Editable fields.** Every field editable inline on the deal record (click-to-edit, save-on-blur, optimistic UI, writes via Airtable API by field ID). Read-only exceptions: Cash chips, Audit Log, Email bodies. Role-gated per §5.
3. **Notifications.** Bell icon + unread count; Notification records fan out in-app and (per user preference) email. Event types: review-queue item, red-alert logistics, stale hold, payment confirmed, mirror error, mention in a note. Per-user mute toggles in Settings.
4. **Macro view:** Pipeline board (six columns, deal cards with fee/date/next-task). **Mini view:** stage strip + task checklist inside each deal. **Cash view:** Owed/Paid/Weighted tiles (role-gated).
5. **Review Queue** as a first-class screen: all proposed Drafts and field-change Proposals, one-click accept/edit/dismiss. This is Liezel's home page.
6. **Airtable fallback (graceful degradation):** the Vercel app is a skin — *all* state lives in Airtable. If Vercel is down, the published Airtable interface (`pbd0fhF4HK7xMXUNx`) exposes the same tables/views; workers keep running (they talk to Airtable, not to the front-end). A "system status" note in Settings links to the fallback interface. Rule for builders: **no logic in the front-end that the data layer can't survive without.**

# 5. USERS & PERMISSIONS

| Role | Sees | Edits | Special |
|---|---|---|---|
| `owner` (Ben) | everything; **money = status chips by default, amounts toggleable in Settings** (resolves the open decision as a setting, not a rebuild) | notes, post-keynote, stage | Field Guide button |
| `admin` (Jordan) | everything | everything + Settings, users, AI providers, tier map | import/export |
| `ops` (Liezel) | everything except Settings | all operational fields, Review Queue, Tasks | send approvals |
| `accountant` | Money interface only (published Airtable interface: Payments ledger, Owed/Received/Net, forecast) — never the base, never ops/CRM | nothing | interface-only collaborator |

Google SSO, per-app allowlist, RBAC enforced server-side (not just hidden buttons). All sends attributed to the approving user in the audit log.

---

# 6. AI RUNTIME — how it actually runs in the cloud (verified against current docs)

**The blunt answer on subscriptions:** a Claude.ai Pro/Max subscription is for humans (and first-party Claude Code use); it is **not** the supported way to power a server app's cron workers, and Anthropic has scoped subscription usage toward first-party interactive/Claude Code invocations. **Louis's workers run on API billing** — either the Anthropic API directly (console.anthropic.com, pay-per-token, budget caps + usage alerts) or **through OpenRouter**, which is already in the stack. Keep the team's Max subscription for the humans (Jordan/Regan building with Claude Code); the app itself gets an API key. Verify current terms at https://docs.claude.com/en/api/overview before wiring billing.

**Recommended runtime (resolves the flagged OpenRouter open-decision):**
- **Gateway = OpenRouter as the routing layer, deliberately.** It gives us the spec's dual-provider requirement natively: primary `anthropic/claude-*`, automatic fallback to a second provider (e.g. `google/gemini-*` or `openai/gpt-*`) if Anthropic errors/timeouts — one key, one bill, provider-agnostic prompts. The gateway package still wraps it (`complete(task, input)`) so we can swap OpenRouter itself later. Document this as the intentional deviation: OpenRouter *is* the interchangeable-AI standard, not a violation of it.
- **Failover logic:** per-call timeout/5xx → retry once → fallback model of same tier → if fallback also fails, queue the job + notification (nothing silently drops). Settings screen: primary/fallback per tier, usage meter, monthly cap.
- **Scheduling:** Vercel Cron (or GitHub Actions cron as free backup) hits worker endpoints: intake every 15 min, timers daily 07:00, mirror on-change + hourly, QA nightly. Workers are plain serverless functions with the API key server-side — no browser, no subscription session, nothing that expires.
- **Cost reality check:** at Ben's volume (~60 inquiries/mo, ~600 emails/mo, Haiku/Sonnet doing 95% of calls) expect tens of dollars/month, not hundreds. Caps at 2–3× expected with alert at 80%.

---

# 7. OPEN QUESTIONS (answer these before Phase 1 locks)

1. **"Updates/changes in emails"** — I've specced F4 as: empty field = silent fill + audit; conflicting value = always a human-approved Proposal + notification. Is that the rule you meant, or did you mean *outbound* email versioning (tracking edits Liezel makes to drafts before send — which we can also log on the Draft record)? Say which (or both).
2. **Notification channels** — in-app + email is specced. Do you want Slack (you already have the warehouse channel) as a third fanout? Cheap to add, decide now so the Notification schema includes it.
3. **Ben's money visibility** — specced as a Settings toggle defaulting to chips-only. Confirm default.
4. **Second provider for the fallback tier map** — Gemini or OpenAI as the non-Anthropic fallback family? (OpenRouter makes this a config value, but pick one to test against.)
5. **Multi-speaker commercial intent** — is the future-speaker plan "we operate installs for clients" (keep per-speaker isolated installs, below) or "productize as SaaS" (would push toward multi-tenant, a much bigger build)? Spec assumes the former.

# 8. MULTI-SPEAKER WHITE-LABEL KIT (build for repeatability from day one)

**Pattern: template, not tenant.** One speaker = one isolated install (own Airtable base, repo fork, Vercel project, Google workspace connections, subdomain) — matching the locked isolation rules and meaning one speaker's outage/breach never touches another.

The kit = what makes stamping a new one fast:
1. **`speaker-template` repo** — the Next.js app with every speaker-specific value externalized to `speaker.config` (name, logo, colors within paper-ink, fee defaults, forecast weights, stage names if they differ, script-bank templates, tier map).
2. **Base template** — Airtable base duplication script (schema + views, no data) + the field-ID binding regenerated automatically on clone.
3. **Script bank as data** — Connor's language lives in a Templates table, not in code; new speaker = new voice, same engine.
4. **Setup runbook** — the credential checklist (Google Cloud project, OAuth, service address, OpenRouter key, watched inbox, allowlist) as a step-by-step doc; target: new speaker live in a day.
5. **What stays shared:** the design-tokens package and the gateway package (published, versioned). **Nothing else at runtime.**

# 9. BUILD PHASES

- **P1 — Spine + shell:** Deal stages on the existing base, stage engine (F5), pipeline board + deal record in Vercel (logo-home, inline edit, roles), Review Queue screen, form intake (F1), mirror (F9). *Airtable fallback proven on day one.*
- **P2 — The memory + the inbox:** timers (F6), drafts engine (F7) with checker, email intake (F2) + change handler (F4), research agent (F3), notifications.
- **P3 — Lifecycle + polish:** import/export (F11/12), QA sweep (F13), journal sidecar UI, Cash seam chips, Opus weekly review, white-label extraction (§8).

---
*v3 canonical, 14 Aug 2026. FigJam: "Louis v3 — All Movement" on board `7G5dzHNyRLDQ0WHqT6ORvO`.*
