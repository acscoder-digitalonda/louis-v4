# LOUIS v3 ↔ SpeakerOS Build Plan — Gap Analysis
### What the new docs add, change, or drop versus the v3 Handoff Package and the live build at louis-v3.vercel.app
*Sources compared: (A) v3 Handoff Package — Rebuild Spec, Data Holding Map, Interface/Dev Handoff, Pipeline Canonical, Connor process; (B) "Ben Nemtin — SpeakerOS — Build Plan" (CRM Field Specification) + Layer 1 Sales Process map + Layer 2 Data Layer map; (C) the live build (pipeline page + nav, fake data).*
*Date: 4 Sep 2026. Precursor to the Add-On Handoff Package.*

---

## 0. EXECUTIVE SUMMARY

**Where we are.** The live build is our v3 spec, faithfully: six stages (Inquiry → Sales → Closed-Won → Pre-Event → Delivered → Debriefed), weighted forecast (25/65 chips visible on Sales cards), next-action chips, T-minus countdowns, and the nav we specced (Pipeline · Deals · CRM · Journal · Money · Queue · Settings). UX/UI, redundancy, and monitoring are ours and stay.

**What the new docs are.** The SpeakerOS Build Plan is a *CRM field specification* — a target-state data model — plus two maps describing Ben's real sales process at field-level detail. It is stronger than our package on **how Ben actually sells** (pricing, bureau mechanics, coaching, follow-up ownership, lost-deal recovery) and weaker on **how the system runs** (no UI spec, no runtime/cost/notification design, no QA/checker layer, no white-label kit, no post-close pipeline). The two are complementary, not competing. The reconciliation is mostly *adopt their data model into our engine*.

**The eight differences that matter (in order of impact):**

1. **Pipeline stages diverge.** Theirs: Inquiry 25% · Qualified 50% · **Firm Offer 95%** · Closed Won · Closed Lost — sales-only stages, no post-close stages. Ours: Sales (merged) → Closed-Won → Pre-Event → Delivered → Debriefed. **Recommend a hybrid**: keep our post-close stages (they drive the delivery packets the build already runs), re-split Sales into Qualified + Firm Offer (Firm Offer is load-bearing for their hold-challenge automation), add Closed Lost with reasons instead of "Dormant." Forecast weights become 25/50/95/100.
2. **A whole second revenue line is missing from ours: Coaching** (Speaker + Executive, 10–15% of revenue, 4 stages, $15K/3 sessions, 50% deposit, Coaching Sessions 1:3 object, delivery ledger, session follow-up automation, "sell the next track"). Deal Type becomes a first-class field with three values.
3. **Pricing engine is missing from ours.** List Amount is a *formula*: Secondary Deal Type (in-person/virtual) × Rate Region (4 bands) × Weekend Event, plus Travel Stipend rules and a full 2026 rate card. We had manual list/negotiated fee fields only.
4. **Products + Deal Line Items replace our Journal sidecar as the money model.** Journal, book, workshop (half/full), Dream Wall, dream fulfillment are line items with quantity + price override rolling into Amount. Standalone Amazon sales are deliberately *out* of the CRM. Our sidecar tracked *fulfillment status* (promo → bulk → shipped), which theirs lacks. **Recommend both**: line items own the money; a fulfillment status lives on the line item, not a separate pipeline.
5. **Bureau modeled as a Company, not a contact attribute.** Deal links to *both* End Client Company and Bureau Company; Deal Name is a 4-way fallback formula; bureau lane has explicit rules (no form, one hold even if several, automation stops at the agent, 50/50 billing). Ours typed bureau agents as Contacts with an agency text field.
6. **Follow-up mechanics are more specific than ours.** Next Action Date (+3 business days), Follow-Up Count, **Next Action Owner formula (0–1 Liezel, 2+ Ben)**, Mute/Mute Until, Decision Date stretching the cadence, daily digest to the owner, capacity rule (max 3 keynotes/week, Liezel checks ±1 day), reply SLA 1 hour. Ours had decision-date timers and a forcing email but no ownership handoff, mute, or capacity check.
7. **Holds: no hold entity, first-right-of-refusal challenge.** Calendar renders Deal Stage; ordering by Create Date per event date; when a later hold reaches Firm Offer, the first hold gets **24 hours** to contract or release. Retires the manual (2)/(3) numbering and the Released Inquiries sheet. Ours had a stale-hold timer only.
8. **Closed-lost re-engagement + historical backfill are new stages (11/12).** Inbox sweep as far back as possible → extracts closed-lost deals + bureau agents → Ben/Liezel vet → segmented 12-month campaign by stage and industry. Ours had import (F11) but no recovery motion.

**Also new/different:** Source + attribution enums, Deal Status Cold/Warm/Hot, Closed Lost Reason list, Event Timezone, Post-Keynote Alert checkbox (one-click handoff), Welcome Kit as a *hosted page* with kit token and a specific trigger *sequence* (Closed Won → contract signed → invoice shared → kit), questionnaire as a 12-field Airtable form pre-populated from the deal, website form +5 fields with a date picker, billing terms (direct = paid in full pre-keynote — a new sales motion), cash layer deferred to phase 2 with QuickBooks read-only, n8n/Zapier as connector fabric, Gumloop as agent fallback.

**What ours has that theirs doesn't (keep all of it):** the UI/IA/theming, Airtable-interface fallback, Review Queue as first-class screen, notifications matrix + failure emails, cost meter + Phase 0→OpenRouter switch, checker passes + QA sweep, audit log, Drive folder structure + assets domain, HubSpot export profile, Git/CI rules, white-label kit, post-close delivery packets, journal fulfillment tracking, money merged in base (theirs defers money entirely).

**Email templates — the honest status:** *neither* package contains a written, ordered email template library. Ours has Connor's script bank (9 talk-tracks, 3 of them email-shaped). Theirs names templated replies (re-engagement, QR follow-up, welcome-kit prompt, staleness digest, post-keynote alert) but writes none of them. Section 4 inventories every email either spec implies, in order, with what exists. **Writing the template library is a deliverable of the add-on package.**

---

## 1. SIDE-BY-SIDE: FUNCTION & ARCHITECTURE

| Area | v3 Package (ours) / live build | SpeakerOS Plan + maps (theirs) | Verdict |
|---|---|---|---|
| **Deal stages** | Inquiry · Sales · Closed-Won · Pre-Event · Delivered · Debriefed (+Dormant) | Inquiry · Qualified · Firm Offer* · Closed Won · Closed Lost (*keynote only; coaching has 4) | **Hybrid** — re-split Sales into Qualified + Firm Offer; add Closed Lost (+reason) replacing Dormant; keep post-close stages |
| **Forecast weights** | 0 (no hold) · 25 (hold) · 65 (proposal sent) · 100 | 25 · 50 · 95 · 100 · 0 | **Adopt theirs** — stage-driven, no checkbox; Firm Offer at 95 |
| **Holds** | Hold created at Sales entry; stale-hold timer; calendar mirror | No hold entity — calendar renders stage; order by Create Date; **24-hr first-right-of-refusal challenge** at Firm Offer | **Adopt** — new automation (challenge timer + notifications) |
| **Deal types** | Keynote only | Keynote · Speaker Coaching · Executive Coaching; coaching = 4 stages, no Firm Offer | **Add coaching** — Deal Type field drives stage set, pricing, kit, delivery objects |
| **Pricing** | Manual List Fee / Negotiated Fee | List Amount formula: Secondary Type × Rate Region × Weekend; Travel Stipend rule; Add-On rollup; Amount = Negotiated‖List + Travel + Add-On; full 2026 rate card | **Adopt** — rate card lives in config (white-label rule) |
| **Add-ons / journal** | Journal Orders table (sidecar), own status pipeline, optional deal link; Amazon orders allowed in CRM | Products + Deal Line Items (qty, price override); Amazon **out** of CRM; workshops are add-ons, never standalone | **Merge** — line items own money; keep fulfillment status *on the line item*; drop standalone Amazon from CRM |
| **Company model** | Clients + Contacts (typed bureau agent w/ agency text) | Companies with two links per deal: End Client + Bureau; bureau pre-loaded dropdown; Deal Name 4-way fallback formula | **Adopt** — Bureau = Company record; keep Contact Type + Key Agent flag |
| **Contacts** | Typed, Key Agent flag, one person one record | Name/email/phone, direct buyer or agent, many per company/deal | Keep ours (superset) |
| **Deal fields** | Decision Date, list/negotiated, proposal-sent ✓, T-minus | + Deal Status (Cold/Warm/Hot), Source enum, "How did you learn" attribution, Closed Lost Reason, Owner (default Liezel), Muted/Mute Until, Next Action Date/Count/Owner, Event Timezone, Record ID sync key, Kick-Off Date | **Adopt all** |
| **Follow-up cadence** | Decision +2d soft check-in (once) → +7d forcing email; timers | Next Action = last activity +3 biz days; Decision Date stretches; Follow-Up Count; **Owner formula 0–1 Liezel / 2+ Ben**; mute; daily digest to owner; clears on close | **Adopt theirs as the engine**, keep our forcing-email as the escalation content |
| **Capacity / SLA** | — | Max 3 keynotes/week (Liezel checks ±1 day); reply target 1 hour; only Ben says no; Ben takes every call | **Add** — capacity check at Qualify; SLA timer on Inquiry |
| **Website form** | Generic F1 intake | 8 fields today → +5: Deal Type, In-person/Virtual, City/State/Country, Kick-Off Date (conditional), attribution; date picker w/ "not known" | **Adopt** — form spec for the web dev |
| **Email intake** | F2: watched label/address, Haiku classify, Sonnet extract, proposals | Sweep Ben's + Liezel's mailboxes (speaking@ + info@ redirect → two inboxes); scheduled; Gumloop fallback | Same mechanism; **change scope** to two full inboxes |
| **Enrichment** | F3 research brief (MVV, LinkedIn, Crunchbase) | Pre-pitch brief (MVV must-have) + **company Industry, Address, Logo from URL** at the Company | **Add** company-level enrichment fields |
| **Email-change handling** | F4: empty=silent fill, conflict=proposal | "Nothing an agent writes reaches a live record without review" — all creates/updates to approval queue | **Tighten to theirs** — every AI write is a proposal (drop the silent-fill exception) |
| **Logistics** | Sections/tabs on Deal + Logistics Items + Field Guide button | **Keynote Logistics 1:1 object** with named fields incl. Event Timezone, Kick-Off Call Date/Held, hotel/ground, Client Assets URL, Contract URL, Welcome Kit URL (token), Post-Keynote Notes, Debrief Call Notes, **Send Post-Keynote Alert ✓** | **Adopt the field list**; tabs already match; add alert checkbox + timezone + kit token |
| **Questionnaire** | Auto-send link when kickoff booked | 12 named fields; Airtable form; **pre-populated from deal** (required); 1:1 object | **Adopt** — pre-population is a build item |
| **Welcome kit** | Drafted at Closed-Won | **Hosted page** (Next.js on Vercel) rendered live from the deal; questions + form link; print/PDF; trigger **sequence**: Closed Won → contract signed → invoice shared → kit; bureau: kit → agent → client | **Adopt** — hosted page + sequenced trigger |
| **Kick-off / debrief** | Kickoff + T-minus timers; debrief slot proposed at Closed-Won | Kick-off 30–60 days out, **never inside 14 days**; debrief booked at kick-off (15–30 min); bureau debrief only with agent buy-in | **Adopt** timing rules |
| **Bureau lane** | Source field; key-agent forward | Explicit lane: no form, email/text; one hold even if several; agent owns contract/invoice/follow-up; **automation stops at agent**; 50/50 billing; kit forwarded by bureau; periodic check-ins only | **Adopt** as lane rules on the stage engine (packets branch on Source=Bureau) |
| **Billing** | Money tables in base; payment plans as schedule legs | Direct: due on signing, **paid in full pre-keynote** (new motion); bureau 50% pre / 50% within 7 days; coaching 50/50, 15% payment plans; Klarna/Affirm proposed | **Adopt terms** into schedule-leg defaults per lane/type |
| **Cash layer** | Merged Money group; F8 in-base match; built in P1 | **Deferred to phase 2**; QuickBooks read-only into a dashboard artifact; contract/payment fields later | **Keep ours built**, but wire QuickBooks read-only as the payment-fact source (their single-home rule: QB owns payment facts) |
| **Closed-lost recovery** | Dormant graveyard | **Stage 12**: sweep extracts closed-lost history; vet; segmented campaign by stage × industry; Closed Lost Reason drives it | **Add** — new worker + campaign templates |
| **Migration** | F11 import w/ mapping, dedupe | 5-step: tracking sheet → inboxes as far back as possible → bureau agents + closed-lost → vet → campaign; **no manual entry** | **Adopt** as the F11 runbook |
| **Repeat loop** | Next-year shell at Debriefed | Debrief opportunity → **new standalone deal** linked to same company; repeats = filter on company (29% of bookings) | Same idea; adopt "new deal, not shell" |
| **AI gateway** | Phase 0 Claude Code → OpenRouter; tier map; cost meter | OpenRouter primary, monthly plan, per-token failover; n8n connector; Zapier backup; Gumloop alt | Aligned; **add n8n as the scheduling/connector fabric option** (decide) |
| **Human gates** | Review Queue, drafts, payments | "Deliberately NOT automated": qualification judgment, pricing/discount (Ben only), contract/invoice review, Ben's pre-event call, context reconciliation | Aligned; add "pricing = Ben only" as a role rule |
| **QR capture** | Drop-down qualifier fix | Same problem stated (75% accidental) | Aligned — ours has the fix |
| **UI / theming / fallback / notifications / cost / QA / Git / white-label / HubSpot export / audit / Drive assets** | Specced and built | Not addressed | **Keep ours** |
| **Permissions** | Roles resolved; Ben chips-toggle; accountant interface-only | Still open in their doc | Keep ours; answer their open question with our roles |

---

## 2. ORDER-OF-OPERATIONS DIFFERENCES (the sequences that changed)

**Direct keynote — theirs, numbered 1–12:**
1–2 Intake (form creates deal, reply ≤1h, source auto) → 3 Qualify + date (AI brief w/ MVV; Liezel checks load ±1 day, max 3/wk) → 4 Discovery (Ben takes every call, Fathom records) → 5 Proposal (fee same day, by region/format; only Ben says no) → 6 Hold mgmt (stage renders calendar; ROFR challenge) → 7 Follow-up (3 biz days; Liezel ×2 then Ben; mute) → 8 Contract + invoice (due on signing, paid in full pre-event) → 9 Pre-event (kick-off 1–2 mo out, never inside 2 wks; questionnaire returned; **debrief booked here**) → 10 Onsite (AV, two HDMI; post-stage notes typed once → alert) → 11 Debrief (15–30 min, at discretion) → 12 Closed-lost re-engagement.

**Ours (live):** Inquiry (ack, brief) → Sales (hold, pitch, proposal, decision timers) → Closed-Won (contract+invoice, kit, debrief slot) → Pre-Event (kickoff, questionnaire, logistics, journal) → Delivered (QR, dropship) → Debriefed (next-year shell).

**Concrete sequencing changes to make:**
- Kit fires **after invoice shared**, not at Closed-Won (direct); goes to **agent** on bureau.
- Debrief is booked **at kick-off**, not proposed at Closed-Won.
- Qualify includes a **capacity check** before a hold is granted.
- Firm Offer triggers the **24-hr challenge** on competing holds.
- Follow-up ownership **escalates to Ben on the 3rd touch**.
- Closed Lost is a real stage with a reason → feeds re-engagement.

---

## 3. LIVE-BUILD OBSERVATIONS (from the pipeline page, fake data)

- Stage model, forecast chips (25%/65%), next-action chips ("Decide whether to release the hold", "Chase countersigned contract", "Confirm journal quantities with the warehouse"), T-minus, and the six-tab nav all match v3. A "TEST APP · $1" deal sits in Inquiry — remove before real data.
- Not verifiable from the page alone (evaluate today): whether proposal-sent flips 25→65 automatically, whether the Queue's 6 items are drafts or field proposals, whether Money reads lookups from the merged tables, and what the Settings AI backend/cost meter shows. Those are the four things I'd check first because the add-on package touches all of them.

---

## 4. EMAIL TEMPLATE INVENTORY — what exists, what doesn't, in order

**Legend:** A = auto-send · D = drafted for human send · H = human writes · ✅ copy exists · 📝 named but not written · ❌ not in either spec

| # | Trigger / stage | Email | Send mode | Ours | Theirs |
|---|---|---|---|---|---|
| E1 | Form/email inquiry received | Intake acknowledgment ("back to you within a couple hours") | A | ✅ Connor line | 📝 "reply target 1 hour" |
| E2 | Inquiry (bureau) | Bureau hold confirmation ("one hold even when several") | D | ❌ | 📝 |
| E3 | Qualified | Discovery-call scheduling / prep questions | D | ❌ (discovery ladder exists as talk-track) | ❌ |
| E4 | Discovery held | Proposal / rate email (fee by region/format, reel, testimonials, tailoring paragraph) | D | ✅ structure from Connor | 📝 "fee sent same day" |
| E5 | Sales, no next call | Soft check-in ("had a chance to talk yet?") — once | D | ✅ Connor | ❌ |
| E6 | Sales, decision date passed | Forcing email ("still considering Ben? if not I'll remove the hold") | D | ✅ Connor | ❌ |
| E7 | Firm Offer on competing hold | **24-hr first-right-of-refusal notice** to first-hold client | D | ❌ | 📝 (automation named, copy not) |
| E8 | Closed Won (direct) | Contract details request (signer, address) | D | ✅ named in ours | ❌ |
| E9 | Contract signed | Invoice email (terms: due on signing / paid pre-event) | D | 📝 | 📝 billing terms only |
| E10 | Invoice shared | **Welcome kit** email w/ hosted-page link + questionnaire prompt | D | 📝 | 📝 hosted page specced, copy not |
| E11 | Closed Won (bureau) | Kit-to-agent email ("please forward to client") | D | ❌ | 📝 |
| E12 | Kick-off booked | Questionnaire link (pre-populated form) | A | 📝 | 📝 |
| E13 | T-14 questionnaire unreturned | Questionnaire chase | D | 📝 | ❌ |
| E14 | Kick-off call | Debrief scheduling ("two weeks after — Monday?") | D | ✅ Connor line | 📝 "booked at kick-off" |
| E15 | Pre-event | Journal promo / address request + "received it? interested?" follow-up | D | 📝 | 📝 "entirely manual chase today" |
| E16 | T-1 | Field guide / road-warrior brief (internal to Ben) | A | ✅ built | ❌ |
| E17 | Post-keynote alert ✓ | Post-keynote notes → Liezel (internal) | A | ❌ | 📝 checkbox trigger |
| E18 | Delivered | Thank-you + deck share + testimonial ask | D | 📝 ("debrief + testimonial ask" chip in build) | 📝 in Post-Keynote Notes purpose |
| E19 | QR opt-in | QR resource follow-up (3 resources + journal link + intent qualifier) | D | 📝 | 📝 "draft to inbox" |
| E20 | Debriefed | Repeat/next-year angle ("leaders this year, managers next?") | D | ✅ Connor line | 📝 new-deal loop |
| E21 | Closed Lost (12 mo) | **Re-engagement campaign** (segmented by stage × industry, customized) | D | ❌ | 📝 stage 12 |
| E22 | Coaching inquiry / non-convert | Coaching intake reply; diagnostic-session offer; session follow-up w/ Fathom; "sell the next track" | D/A | ❌ | 📝 |
| E23 | Internal daily | Staleness / next-action digest to owner (muted excluded) | A | ✅ specced (notifications) | 📝 |
| E24 | Internal | Worker-failure / cap alerts | A | ✅ specced | ❌ |

**Bottom line:** 7 have real copy (all from Connor's transcript), ~14 are named in one or both specs with no copy, 3 are entirely new to theirs (E7, E21, E22). The add-on package should ship all 24 as Templates-table records in Ben's voice (the `ben-email-style` skill exists for exactly this), each tagged with trigger, send mode, and lane (direct/bureau/coaching).

---

## 5. RECOMMENDED RECONCILIATION — decisions to take

**Adopt outright (data model & rules):** Deal Type ×3, Secondary Deal Type, Rate Region + pricing formulas + rate card (as config), Travel Stipend rule, Products + Line Items, Bureau-as-Company + dual links + Deal Name formula, Source/attribution/Status/Closed-Lost-Reason enums, Mute/Mute Until, Next Action Date/Count/Owner formula, Event Timezone, Post-Keynote Alert checkbox, 12-field questionnaire pre-populated, hosted welcome kit + trigger sequence, kick-off timing rules, bureau lane rules, billing terms per lane, capacity check + 1-hour SLA, ROFR 24-hr challenge, closed-lost re-engagement (stage 12), migration runbook, coaching line.

**Adapt (merge with ours):** stages → 8-stage hybrid (Inquiry · Qualified · Firm Offer · Closed-Won · Pre-Event · Delivered · Debriefed · Closed Lost) with 25/50/95/100/0; journal fulfillment status moves onto line items; F4 tightened to "every AI write is a proposal"; email intake scope → two full inboxes; QuickBooks becomes the read-only payment-fact source feeding our built Money tables (rather than deferring cash).

**Keep ours (they don't cover it):** UI/IA/theming, fallback, Review Queue, notifications + failure emails, cost meter + backend switch, checker/QA, audit log, Drive/assets domain, HubSpot export, Git/CI, white-label kit, post-close packets.

**Decide (open):** n8n as connector fabric vs. our serverless workers (adds a platform; buys visual debugging) · Gumloop fallback (probably no) · Klarna/Affirm for coaching · Dream Wall / dream fulfillment pricing · whether standalone Amazon journal sales leave the CRM (theirs) or stay as unlinked orders (ours).

---

## 6. PLAN — from here to the Add-On Handoff Package

1. **Today — evaluate the live build against v3** using §3's four checks + the standard pass (both themes, mobile, inline edit, audit writes, queue accept/dismiss, notifications, cost meter, Airtable fallback).
2. **Decisions session (30 min)** — the "Decide" list in §5 plus the questions in §7. Everything else is pre-decided as adopt/adapt/keep.
3. **Write the Add-On Handoff Package** (I draft, you review): (a) schema delta — every new field/table with type, formula, owner; (b) stage-engine delta — 8-stage hybrid, packets per stage × lane × deal type; (c) new workers — ROFR challenge, capacity check, SLA timer, owner-escalation, closed-lost re-engagement, historical backfill, company enrichment, coaching session ledger; (d) **Email Template Library** — all 24 templates written in Ben's voice, as Templates-table records; (e) website form spec (+5 fields); (f) hosted welcome-kit page spec; (g) migration runbook; (h) updated FigJam (pipeline v3 + data map v3).
4. **Dev executes as PRs against the existing repo** — additive, no rebuild; each delta is its own PR mapped to a section of the package.

---

## 7. QUESTIONS (answers shape the package)

1. **Stages:** OK with the 8-stage hybrid (re-split Sales into Qualified + Firm Offer, add Closed Lost)? It changes the pipeline board from 6 to 7 visible columns + a collapsed Closed Lost.
2. **Coaching:** build it now, or schema-only now (Deal Type + Coaching Sessions object) with the coaching delivery automations in a later pass?
3. **Cash:** their plan defers money to phase 2; ours is built. Keep the Money group live and wire QuickBooks read-only into it — or park Money until the CRM delta lands?
4. **Amazon journal sales:** out of the CRM (theirs) or kept as unlinked orders (ours)? Affects whether the Journal tab is "add-ons per deal" only.
5. **n8n:** do they/you want n8n as the scheduling/connector layer, or keep our serverless workers + Vercel cron? (Both work; n8n is a second platform to maintain and secure.)
6. **Email templates:** confirm I write all 24 in Ben's voice via the ben-email-style skill, and confirm who approves copy (Ben? Liezel?) before they become live templates.
7. **Inboxes:** confirm the sweep scope is Ben's + Liezel's full mailboxes (speaking@ and info@ redirect there), not a watched label — that's a Gmail OAuth scope change.
8. **Rate card:** the 2026 figures in their doc ($37.5K US, $50K/$60K/$70K bands, $20K virtual, $2.5K US travel buyout) — treat as authoritative config values?
9. **Bureau list:** still "[ADD BEN'S BUREAU PARTNER LIST]" in their doc — who's providing it, and when? It seeds the Bureau Company dropdown.
10. **Attio:** their doc says "Attio is gone" — I'll take that as the confirmation and strike it from our docs in the add-on package unless you say otherwise.
