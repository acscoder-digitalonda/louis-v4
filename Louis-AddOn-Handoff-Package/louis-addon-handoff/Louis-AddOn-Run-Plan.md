# LOUIS ADD-ON HANDOFF — Run Plan for Claude Code
### Fable architects and checks · Opus/Sonnet/Haiku subagents do the work in parallel · additive PRs against the existing repo
*4 Sep 2026. This is the entry document. Everything else in this package is referenced from here.*

---

## 0. HOW TO RUN THIS (for An, in Claude Code)

**Model roles.**
- **Architect / checker: Fable 5.1.** Reads this whole package first, produces the work-package graph (§3), assigns subagents, reviews every PR against the acceptance criteria, and owns the migration and the final integration test. Fable never writes bulk code; it decides, reviews, and resolves conflicts between subagents.
- **Workers: Opus 5** for schema design, the stage-engine rewrite, the social-proof resolver, and anything touching money or auth. **Sonnet 5** for templates, seeds, UI tabs, settings screens, notifications, tests. **Haiku 4.5** for mechanical passes: field-ID constant regeneration, CSV validation, lint fixes, changelog.
- **Parallelism.** Work packages in the same tier of §3 have no shared files and run as parallel subagents on separate branches. Fable merges tier by tier. Never let two subagents touch `fields.ts`, the stage engine, or the Airtable schema at the same time; those are serialized (Tier 0).

**Rules that override everything.**
1. Additive only. No rebuild. Every change is a PR against `main` with the existing CI (typecheck, lint, no-hardcoded-hex, gitleaks) green.
2. Config over code: every rate, weight, timer day-count, stage name, and template lives in Airtable config tables or `speaker.config`. If a subagent types a dollar amount or "Ben" into a component, Fable rejects the PR.
3. Every AI write is a proposal in the Review Queue. No silent fills (this tightens the earlier F4 rule).
4. **No limits.** No capacity caps, no date guards. Every T-minus timer is "at T-x, or immediately if T-x has passed." Last-minute deals never break; they compress.
5. Money: keep the built Money group; QuickBooks is a read-only payment-fact source. No cross-base sync.
6. Secrets: server-side env only, per-environment keys, never in Airtable, repo, logs, or a Claude Code cloud environment. No `ANTHROPIC_API_KEY` anywhere near a Claude Code session.
7. The dev opens GitHub issues for questions; nothing is decided in chat.

---

## 1. WHAT THIS ADD-ON DOES (one paragraph)

It adopts the SpeakerOS data model (deal types, pricing engine, line items, bureau-as-company, follow-up mechanics, closed-lost recovery, coaching schema) into the existing Louis v3 engine and UI, adds the pieces neither spec had (fulfillment pipeline, journal history, manual date-conflict handling, social-proof first reply, 31 email templates in Ben's voice, multi-mailbox intake, Road Warrior travel trigger, mode dial, failover alerts, Twilio, MCP server, Git-backed backup), imports 7 years of history, and leaves the runtime as all-credit serverless workers on OpenRouter.

---

## 2. THE PACKAGE (reading order for Fable)

| # | File | What it is |
|---|---|---|
| 1 | `Louis-AddOn-Run-Plan.md` | this file: rules, work packages, acceptance, migration |
| 2 | `Louis-v3-Gap-Analysis-SpeakerOS.md` | what changes vs the built v3 and why; §1 table is the adopt/adapt/keep list |
| 3 | `Louis-AddOn-Decisions-Log.md` | decisions D1 to D12 + designs: journal history, fulfillment pipeline, date-conflict flow, rate-card table, templates screen, inbox toggle |
| 4 | `Louis-AddOn-SocialProof-Import-MCP-Backup.md` | social-proof resolver + E01b, history import rules, MCP server, backup design |
| 5 | `Louis-Email-Template-Library.md` + `louis-email-templates.csv` | 31 templates, seed for the Templates table |
| 6 | `louis-testimonials-seed.csv` | 74 testimonials with industry/format tags |
| 7 | `louis-past-clients-by-industry.csv` | 718 rows, seed/fallback for company rollups (reclassified) |
| 8 | `louis-reclassified-companies.csv` | the 172 previously unclassified clients: industry, sub-industry, confidence; 11 "Needs review" |
| 8b | `Louis-GoLive-Cutover-Runbook.md` | WP4.3: purge sample data, load history, seed the live pipeline from calendar + inboxes + sheets, flip the calendar, go live |
| 9 | `reference/SpeakerOS-Build-Plan.docx` + 2 Figma-map PDFs | the source spec these deltas adopt from |
| 10 | `reference/keynotebookingsmaster.xlsx` + `familiarlistcrm.xlsx` | the 7-year history to import |
| 11 | `reference/v3/*` | the original v3 handoff (Rebuild Spec, Data Map, Interface Handoff) for context |

Runtime decisions not in the docs above (from the 4 Sep session): **all credit, no subscription**; detect every 6 min (Vercel cron or Gmail push, delegated service account, Haiku classify), think every 30 min when the stack is non-empty; **Mode dial** LAUNCH / STEADY / ECONOMY with per-task tier maps (LAUNCH = Opus for intent/extraction/research/drafts, Fable for weekly review + escalations + checker audit, Sonnet checks, Haiku classifies); OpenRouter single key with Claude → GPT fallback chain; Twilio (company account) as fourth channel; notifications matrix per user with quiet hours; new non-batchable events failover / restored / worker-failure / date-conflict / cap-hit.

---

## 3. WORK PACKAGES (tiered; same tier runs in parallel)

### Tier 0 — Schema & spine (serialized, Opus, Fable reviews before anything else starts)
- **WP0.1 Schema delta.** New/changed tables and fields: Deal Type ×3, Secondary Deal Type, Rate Region, Weekend Event (formula), Travel Stipend, Products, Deal Line Items, Add-On Amount (rollup), Amount (formula), Bureau Company link + Deal Name formula (4-way fallback), Source/attribution/Deal Status/Closed Lost Reason enums, Muted/Mute Until, Next Action Date/Follow-Up Count/Next Action Owner (formula 0 to 1 Liezel, 2+ Ben), Event Timezone, Kick-Off Date, Keynote Logistics fields incl. **Travel Departure Date, Outbound/Return Flight, Post-Keynote Alert ✓, Kit Token**, Coaching Sessions (1:3), Fulfillment, Standalone Orders, Date Conflicts, Rate Cards, Templates, Testimonials, Mail Accounts, Company Domain + journal rollups on Companies (Journals Purchased lifetime, Last Journal Order, Purchase History), Usage Log additions. Two new industry values: Government & Public Sector, Sports & Entertainment. Regenerate `fields.ts`. *Acceptance: every field has one owner; no formula hardcodes a number that Rate Cards or config should own.*
- **WP0.2 Stage engine v2.** Eight stages (Inquiry 25 · Qualified 50 · Firm Offer 95 · Closed-Won 100 · Pre-Event · Delivered · Debriefed · Closed Lost 0; coaching skips Firm Offer). Packets branch on Deal Type × Lane (Direct/Bureau). Timers rewritten as "at T-x or immediately if passed." Kit fires after invoice-shared (direct) / to agent (bureau). Debrief booked at kick-off. No capacity or date guards. *Acceptance: a deal created at Closed-Won with an event in 6 days fires every due packet in order without error.*

### Tier 1 — Engines (parallel)
- **WP1.1 Pricing** (Opus): Rate Cards table seeded with the 2026 rows (weekend surcharge only where the row says so), List Amount lookup, Travel Stipend + Travel Terms, Products seeded (journal tiers, book, half/full day, Dream Wall/dream fulfillment at $0 override), Add-On rollup. Pricing edits = Ben only.
- **WP1.2 Follow-up & mute** (Sonnet): Next Action engine, owner escalation, mute/unmute, daily digest to owner (muted excluded), clears on close.
- **WP1.3 Date conflicts** (Opus): detection on Firm Offer/Closed-Won/new hold on same date (config window for international), Date Conflict record with side-by-side view, red-alert notify Ben + Liezel, E07 draft with blank deadline, resolution options incl. Both feasible (auto-dismisses draft), 24h countdown display only, never auto-release, never mutable.
- **WP1.4 Fulfillment pipeline** (Sonnet): Fulfillment record per physical line item, statuses, Ship-By, T-45/T-35/T-14 nudges, board on Journal tab, digest inclusion; money stays on line item.
- **WP1.5 Drafts engine v2 + social proof** (Opus): Templates table driven, variable resolver incl. social-proof resolver (industry → related clients 3 to 5 → one testimonial by industry → format → recency), voice checker (dashes, contractions, length, closer), Gmail Drafts via delegation into the named sender's mailbox, unresolved variables block + flag.
- **WP1.6 Intake v2** (Sonnet): Mail Accounts table, domain-wide-delegated service account, full-mailbox vs watched-label toggle, cross-account dedupe on message-ID, 6-min detect loop (form = no AI; email = Haiku classify), 30-min conditional think trigger, immediate for Key Agent/form inquiries, E01 auto-ack then E01b draft within the hour.
- **WP1.7 Closed-lost recovery + enrichment** (Sonnet): Closed Lost Reason drives E21/E21b at 12 months, segmented by reason × industry; company enrichment (industry, address, logo, domain from URL) runs on the 189 imported unknowns and any new company.

### Tier 2 — UI & settings (parallel, Sonnet)
- **WP2.1 Pipeline board**: 7 columns + collapsed Closed Lost; conflicts strip; Deal Type filter.
- **WP2.2 Deal record**: Sales tab gains pricing block (list/negotiated/travel/add-ons/amount), decision date, next action, mute; Journal tab shows line items + fulfillment strip + company purchase history chip; Logistics tab gains travel fields + Post-Keynote Alert; Overview shows "short runway" tag and past-purchases chip.
- **WP2.3 Settings**: Templates (list by stage, inline edit, variable validation, preview with real deal, voice checker advisory); Rate Cards; Testimonials; AI (Mode dial, tier map per mode, OpenRouter key status, usage meter with cap and cap-hit behavior); Intake (mail accounts, scope toggle, cadence, lookback); Notifications (matrix with SMS column, quiet hours, add-user flow); Users.
- **WP2.4 Company & CRM pages**: bureau vs direct views, Bureau Company records, purchase-history card, repeat-client count.

### Tier 3 — Runtime, alerts, MCP, backup (parallel)
- **WP3.1 Gateway & failover** (Opus): OpenRouter single key, mode-driven tier map, fallback chain Claude → GPT, timeout/retry/fallback/queue, Usage Log per call, `failover` and `restored` events, cap warning/hit behaviors. Fable does a fallback drill: kill the primary in staging, confirm workers complete on GPT and alerts fire.
- **WP3.2 Notifications v2** (Sonnet): Twilio channel, push, matrix + quiet hours, non-batchable set, failure emails with log tail.
- **WP3.3 Road Warrior** (Sonnet): trigger T-1 from Travel Departure Date (fallback event date minus 1), button on demand, re-send on logistics change with "updated" header, full contents per spec, Liezel cc.
- **WP3.4 Louis MCP server** (Opus): SSO + role-checked endpoint; read tools; audited admin writes; no money writes; revocable per-user token in Settings.
- **WP3.5 Backup** (Haiku): nightly full JSON export per table committed to private `louis-data-backup` repo; monthly Airtable snapshot reminder; restore script + quarterly drill runbook.

### Tier 4 — Seeds & history import (Fable-supervised)
- **WP4.1 Seeds** (Haiku validates, Sonnet loads): Templates (31), Testimonials (74), Rate Cards, Products, Bureau Companies (normalized synonym map from the bookings master), industry enum additions.
- **WP4.2 History import** (Opus, dry-run first): bookings master → Companies/Deals/Contacts/Bureau Companies per the mapping in doc 4 §2; familiar list → Contacts; reclassified industries applied; dedupe rules; all rows tagged `Source = Import (bookings master 2026-09)`; 13 needs_review + 11 industry needs-review surfaced as a Liezel task list; rollback script. Fable signs off on the diff before the live run.

- **WP4.3 Go-live cutover** (Fable-supervised; Opus for calendar and inbox extraction): see `Louis-GoLive-Cutover-Runbook.md`. Key fact: the bookings master has **no future rows** (ends 14 Jul 2026), so the live pipeline is seeded by a one-time reverse read of Ben's calendar (from 1 Jun 2026, +18 months), a sweep of both mailboxes from 1 Jun 2026, Liezel's tracking sheets, and QuickBooks read-only, all as proposals reconciled by Liezel and Ben in a batch Review Queue session before the one-way calendar mirror is switched on. Sample data is exported to `fixtures/` then purged; config tables survive.

### Tier 5 — Integration (Fable)
- End-to-end test on staging: form inquiry → E01 → E01b with social proof → Qualified → Firm Offer on a date with a hold → conflict flagged → Closed-Won → contract → invoice → kit → questionnaire → kick-off → debrief booked → journal line item → fulfillment → Road Warrior at T-1 travel → Delivered → E18 → Debriefed → next-year deal. Then a 6-day last-minute deal. Then the fallback drill. Then a restore drill.

---

## 4. ACCEPTANCE (Fable's checklist per PR)
- Works on mobile viewport and both themes; keyboard accessible.
- Every write audited; every AI write is a proposal.
- No hardcoded hex, no hardcoded speaker values, no limits or date guards.
- Field IDs from `fields.ts` only.
- Templates pass the voice checker; no em/en dashes anywhere in client-facing copy.
- Usage Log row for every model call, including failovers.
- Tests: unit for formulas (List Amount, Deal Name, Next Action Owner, Forecast), integration for stage packets by Deal Type × Lane, snapshot for each template render with a real deal.

## 5. OPEN ITEMS FOR JORDAN/BEN (do not block the build; surface in the Liezel task list)
- Bureau list final review after the synonym-map normalization (seeded from history).
- Dream Wall / dream fulfillment pricing.
- Overseas weekend-surcharge cells (seeded 0).
- 11 "Needs review" companies + 13 direct/bureau `needs_review` rows.
- Template copy sign-off before Active (proposal: Ben skims, Liezel approves the ones she sends).
- Twilio 10DLC status on the company number.
- Google Workspace admin to grant domain-wide delegation (all mailboxes are on bennemtin.com; one grant).

*Note on how the classification seed was produced: the 172 unclassified companies were hand-classified in this session directly (not by parallel subagents, which this chat can't spawn); the parallel pattern above is for the build itself. Confidence is recorded per row so WP1.7's enrichment can overwrite medium/low entries with URL-derived data.*
