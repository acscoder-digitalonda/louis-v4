# Louis Add-On — Decisions Log & Design Recommendations
### Round 1, 4 Sep 2026. Feeds the Add-On Handoff Package.
*Companion to `Louis-v3-Gap-Analysis-SpeakerOS.md`. Everything marked ADOPT/ADAPT there is in scope unless overridden below.*

---

## Decisions taken (Jordan, 4 Sep)

| # | Topic | Decision |
|---|---|---|
| D1 | Stages | **8-stage hybrid confirmed:** Inquiry 25 · Qualified 50 · Firm Offer 95 · Closed-Won 100 · Pre-Event · Delivered · Debriefed · Closed Lost 0 (collapsed column, reason required). Coaching uses the same field minus Firm Offer. |
| D2 | Coaching | **Schema now, automations later.** Deal Type ×3, Kick-Off Date, Coaching Sessions object (1:3), coaching pricing in Products. Templates E22 to E22d ship now so the engine is ready. No coaching workers in this pass. |
| D3 | Money | **Keep ours built.** Money table group stays live. QuickBooks becomes the read-only payment-fact source feeding it (single-home rule: QB owns payment facts, Louis renders them). Their "defer cash to phase 2" is not adopted. |
| D4 | Workers | **Keep serverless workers + Vercel cron.** No n8n, no Gumloop, no Zapier layer. |
| D5 | Email templates | **All 30 written in Ben's voice** via the ben-email-style skill, delivered as `Louis-Email-Template-Library.md` + `louis-email-templates.csv`. Editable in one place (see §5). |
| D6 | Inbox scope | **Full mailboxes now** (Ben's + Liezel's, speaking@ and info@ redirect there) **with a Settings toggle to switch to a watched label.** |
| D7 | Journal history | **Must persist on the client record** across years, money kept separate (see §1). |
| D8 | Fulfillment | **Own related pipeline**, not buried in a line item (see §2). |
| D9 | ROFR challenge | **Manual, flagged immediately, never auto-dropped, draft-only email** (see §3). |
| D10 | Rate card | **Make pricing data, not a hardcoded formula**, with per-region weekend rules (see §4). |
| D11 | Attio | Struck. Their doc confirms "Attio is gone." Removed from credentials and all docs in the add-on package. |
| D12 | Everything else in the gap analysis marked ADOPT/ADAPT | In scope, as written. |

---

## §1 Journal history on the client record (D7)

**Problem:** "They bought 2,000 journals last year" must be visible the moment anyone opens the company or a new deal with them, without digging into old deals or money.

**Design:**
- **Companies gain three rollup/formula fields** from Deal Line Items across all their deals: `Journals Purchased (lifetime)` (sum of qty where product = journal or book), `Last Journal Order` (date · qty · event name), and `Purchase History` (a generated list: "2025 Leader Summit · 2,000 journals · 2024 Annual Meeting · 500 journals + 200 books"). Read-only, always current, no money amounts.
- **Standalone orders keep a slim record.** A `Standalone Orders` table (company link, date, channel = Amazon / direct / dropship, qty, product) with **no money fields**. Revenue for these stays outside the CRM as their doc wants; the *fact* of the purchase stays in. Counts toward the company rollups above.
- **Surfaced in three places:** the Company page header ("Past purchases" card), the Deal Overview tab as a chip ("Bought 2,000 journals in 2025") on any new deal for that company, and the **F3 research brief** ("Prior relationship: 2 keynotes, 2,500 journals lifetime"). Ben never walks into a call not knowing.

## §2 Fulfillment as its own pipeline (D8)

**Design:**
- **`Fulfillment` table**, one record per *physical* line item (journals, books; not workshops or Dream Wall). Created automatically when a line item is added. Linked to the line item, the deal, and the company.
- **Status pipeline:** Mentioned → Promo Sent → Promo Received → Interested → Quote Sent → Ordered → Warehouse Notified → Shipped → Delivered → (Dropship Pending → Dropship Complete). Plus `Ship-By Date` (formula: Event Date minus configured lead days), `Qty`, `Warehouse Notes`, `Tracking`, `Slack Thread`.
- **Never lost:** a Fulfillment record is *open* until Delivered. Open records appear on the **Journal tab as a kanban board across all deals**, in the deal's Journal tab as a strip, and in the daily digest when Ship-By is inside 14 days and status is before Shipped. Timers: T-45 and T-35 nudge if Interested with no order; T-14 red alert if Ordered but Warehouse not notified.
- **Money stays on the line item** (qty × tier price or override → Add-On Amount rollup). Fulfillment holds zero money.

## §3 Right-of-refusal challenge, manual (D9)

**Principle:** the system detects and flags; Ben decides; nothing changes state until a human marks it resolved. Sometimes two gigs in one day is doable, so the system must never assume a conflict is a conflict.

**Design:**
- **Trigger:** any deal reaches Firm Offer (or Closed-Won) on a date that already carries one or more active holds (Inquiry/Qualified/Firm Offer), *or* a new hold lands on a date with a Firm Offer. Same event date, or adjacent dates if either deal is international (config: `conflict_window_days`, default 0 domestic, 1 international).
- **Creates a `Date Conflict` record:** links every deal on that date; shows side by side for each: client, bureau, lane, city + country, stage time + timezone, fee, hold order (by Create Date), current stage, decision date. Status: **Open → Resolved**. Resolution options Ben picks: `Both feasible` · `Release first hold` · `Release later hold` · `Negotiate` · `Other (note)`.
- **Notifies immediately:** Ben + Liezel, in-app + email, tagged red-alert, not batchable. Badge on both deal cards ("Date conflict") and a Conflicts strip at the top of the Pipeline board until Resolved.
- **Drafts, never sends:** E07 (ROFR notice) is drafted into the Review Queue with `deadline` blank; it stays a draft until Ben resolves the conflict and Liezel or Ben fills the deadline and sends. If Ben chooses `Both feasible`, the draft is dismissed automatically.
- **The 24-hour clock is a display, not an action.** Once E07 is sent, a countdown shows on the conflict record and the first-hold deal; expiry raises another notification. It never releases a hold. Releasing = a human sets stage to Closed Lost (reason: Dates didn't work) or the deal proceeds.
- **Persistence:** an Open conflict cannot be hidden, muted, or aged out. It appears in every digest until Resolved.

## §4 Rate card as data, not formula (D10)

**Problem:** their List Amount formula hardcodes bands and applies a weekend surcharge to the US/Canada band only. Real practice differs by region (overseas gigs consume the weekend in travel anyway, so a weekend surcharge there isn't a thing, and "further afield" pricing already prices in the trip). A formula hardcoding this will be wrong somewhere, and wrong for every future speaker.

**Recommendation: a `Rate Cards` table, looked up by the deal.** One row per (region × format × effective year):

| Field | Example (US / non-remote Canada, in-person, 2026) |
|---|---|
| Region | US / non-remote Canada |
| Format | In-person |
| Base Fee | 37,500 |
| Weekend Surcharge | 2,500 (blank or 0 = no surcharge) |
| Weekend Rule | `Sat/Sun event date` (or `none`, or `Sat/Sun travel days` for future use) |
| Travel Buyout | 2,500 |
| Travel Terms | "Client covers ground and hotel" (text, rendered into E04/E09/contract) |
| Effective From / To | 2026-01-01 / blank |

Then on the deal: `List Amount = Rate Card.Base Fee + IF(Weekend Event AND Rate Card.Weekend Surcharge, surcharge, 0)`; `Travel Stipend = Rate Card.Travel Buyout` (manual override kept); `Virtual` is just another row (Region = Any, Format = Virtual, 20,000, no surcharge, no travel).

- Overseas bands get `Weekend Surcharge = 0` and `Travel Terms = "Client books lie-flat first class on Ben's choice of airline, plus ground and hotel"`. If Ben later decides a weekend *does* cost extra in Europe, it's a cell edit, not a formula change.
- Add a per-deal **`Pricing Note`** (free text, Ben only) and keep **`Negotiated Amount`** as the truth. List Amount is hygiene and forecast default, exactly as their doc says.
- White-label win: a new speaker's pricing is a CSV import into Rate Cards. Zero code.
- Seed the 2026 rows from their doc's figures (37.5K US/Canada +2.5K weekend; 50K Mexico/Caribbean/Central America/remote Canada; 60K Europe/South America/Japan; 70K Middle East/India/Africa/Asia/Australia; 20K virtual; +7K half day / +14K full day as Products) and **have Ben confirm the overseas weekend cells** before go-live.

## §5 Templates editable in one place (D5)

- **`Templates` table in Airtable** seeded from `louis-email-templates.csv` (30 records). Fields: Template ID, Name, Stage, Lane, Deal Type, Trigger, Send Mode, Sender, Register, Subject, Body, Variables, Notes, Active.
- **Settings → Templates screen** in the app: list by stage, click to edit subject/body inline, live variable validation (unknown `{{var}}` highlighted), a "preview with a real deal" button, and version history (Airtable's, plus an Audit Log entry per edit). Ben edits copy; nobody edits code.
- **Voice checker** runs on save and on every generated draft: flags dashes, missing contractions, over-length, banned openers ("I hope this finds you well"), and a missing closing question or handoff. Advisory, not blocking.
- **Variables resolve from:** deal, company, contacts, logistics, fulfillment, speaker config (`reel_url`, `rate_card_url`, `testimonials_url`, slots). Unresolvable variables block the draft and show why in the queue.

## §6 Inbox scope toggle (D6)

- **Settings → Intake → Scope:** `Full mailboxes` (default; lists connected accounts: Ben, Liezel) or `Watched label` (label name per account). Switching takes effect on the next sweep.
- **OAuth is requested at full-mailbox read scope at consent time** so toggling never triggers a re-consent. Send scope is separate and only for the drafts engine's Gmail Drafts writes.
- Sweep cadence and lookback (for the historical backfill: "as far back as possible") are also Settings values.

## §7 Also in scope from the gap analysis (not re-argued here)

Deal Type ×3 · Secondary Deal Type · Rate Region · Products + Deal Line Items · Bureau as Company + dual links + Deal Name formula · Source / attribution / Deal Status / Closed Lost Reason enums · Mute / Mute Until · Next Action Date / Follow-Up Count / Next Action Owner formula (0 to 1 Liezel, 2+ Ben) · Event Timezone · Post-Keynote Alert checkbox · 12-field pre-populated questionnaire · hosted Welcome Kit page + trigger sequence (Closed-Won → contract → invoice → kit) · kick-off timing (30 to 60 days out, never inside 14) · debrief booked at kick-off · bureau lane rules (automation stops at agent, 50/50 billing) · capacity check (max 3/week) + 1-hour SLA · closed-lost re-engagement (12 months, segmented) · migration runbook (sheet → inboxes → vet → campaign) · company enrichment (industry, address, logo from URL) · every AI write is a proposal · website form +5 fields with date picker.

---

## Open before the package is written

1. Bureau partner list (seeds the Bureau Company dropdown). Who and when?
2. Dream Wall / dream fulfillment: priced or free? (Held at $0 with override until answered.)
3. Overseas weekend surcharge cells: Ben to confirm 0 for the three international bands.
4. Copy approval: who signs off the 30 templates before they're set Active? (Proposal: Ben skims, Liezel approves the ones she sends.)
5. Conflict window for international dates: 1 day either side OK as default?
