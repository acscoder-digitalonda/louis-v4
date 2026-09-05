# Louis Sales Pipeline — Canonical v2
### Six-stage spine · Journal sidecar · G Suite mirror & backup
*Supersedes the stage section of `Connor-Keynote-Sales-Process.md`. Pairs with the FigJam board.*

---

## The one-sentence model

**A deal moves through six stages. Every time it changes stage, the system drafts the next thing. A human clicks send.**

Three trigger types (stage change · timer · money event) × three action types (draft an email · create a task · update a status). Anything that doesn't fit the grid is a bells-and-whistle — parked.

---

## The spine

**Inquiry → Sales → Closed-Won → Pre-Event → Delivered → Debriefed** (+ **Dormant** graveyard, fed by timers and "park" decisions)

Plain-language version for Ben & Liezel: *Inquiry is "should we?", Sales is "selling it," Closed-Won is "paperwork," Pre-Event is "getting ready," Delivered and Debriefed are "harvest."*

| Stage | Exit condition | Packet (fires on entry / during) |
|---|---|---|
| **Inquiry** | Ben decides: pursue or park | Auto-ack email (auto-send); prep doc drafted to Ben's inbox (mission/vision/values, LinkedIn, Crunchbase, budget signals); park → Dormant |
| **Sales** | Verbal yes | On entry: hold placed on calendar + date-check task. During: pitch call → proposal drafted from asset library; **required field: decision date**; timers off that date (next-call-booked check → soft check-in draft, once → forcing-email draft); fee fields (list / negotiated); proposal-sent checkbox |
| **Closed-Won** | Contract signed + invoice out | Contract & invoice generated for human review; contract-details request + welcome kit drafted; debrief slot proposed for the kickoff call |
| **Pre-Event** | Event date passes | Kickoff call scheduled → **questionnaire link (auto-send once call is booked)**; logistics checklist spawned (Liezel's view); journal sidecar armed; T-minus timers (questionnaire chase T-14, logistics red-alert T-12, Road-Warrior brief button T-1) |
| **Delivered** | Debrief held or declined | QR follow-up drafts (~2h after event); journal post-event dropship flow |
| **Debriefed** | — | Next-year deal shell if flagged; feedback logged to client intelligence |

### Forecast rules (a formula on the stage field — cashflow is a view, not a system)
- Inquiry, no hold: **$0** forecast
- Sales, hold placed: **25%** of fee
- Sales, proposal sent (checkbox): **65%**
- Closed-Won onward: **100%**
- Dashboard shows three columns only: **Owed / Paid / On Hold (weighted)**

### Auto-send tier (the only three things that send themselves)
1. Intake auto-ack ("back to you within a couple hours" — team BCC'd)
2. Questionnaire link, once the kickoff call is booked
3. Internal alerts (stale holds, red-alert logistics, payment matched — to the team, never to clients)

Everything else — proposals, follow-ups, forcing emails, welcome kit, debrief scheduling, journal follow-ups — is **drafted** at the right moment with the right context; Liezel or Ben spends 20 seconds and clicks send. Connor's script bank is the template layer.

---

## Journal sidecar (child records, not a stage)

Journal Orders table linked to the deal. One keynote can spawn several: promo, bulk, post-event dropship, Amazon tail.

**Mentioned → Promo Sent → Received-confirmed → Interested → Bulk Ordered → Shipped** (→ optional Post-Event Dropship)

Anchor points on the keynote timeline:
1. **Pre-Event entry:** asset pack includes the journal video. Ben mentions it on the kickoff call → one click flips to Promo Sent → drafts Liezel's address-request email → timer drafts the "received it? interested for the event?" follow-up.
2. **Timers vs. event date:** bulk orders want to land ~1 month out; warehouse needs 2-day minimum over 200 units → nudges at T-45 / T-35 if promo is out but no order.

Keynote money and journal money are separate records rolling up to the same deal. The weighted forecast applies to keynote holds only — journal orders are either ordered or not.

---

## Mirror & backup architecture — G Suite only

The principle: **Airtable is the working system; G Suite is the mirror Liezel already trusts and the backup that survives anything.** Nothing about her existing rhythm ("it goes on the calendar and the sheet") is taken away — the system does the mirroring for her.

| Layer | Role | Direction |
|---|---|---|
| **Google Calendar** | Live mirror of holds & events — color-coded exactly as today (hold stage = color). Humans can still read/trust the calendar alone. | Airtable → Calendar (one-way, on hold create/update/release) |
| **Google Sheets** | Nightly snapshot of Deals, Contacts, Journal Orders — Liezel's familiar fallback, unchanged format. Sheets version history = time machine (restore any prior day). | Airtable → Sheets (one-way, nightly) |
| **Google Drive** | Doc assembly: one folder per deal, auto-created at Sales entry. Contracts, invoices (PDF copies), welcome kit, questionnaire responses, prep docs, debrief notes, client intelligence. Drive version history covers edits. | System writes; humans read/add |

Recovery story: if Airtable is ever corrupted or a bad sync deletes records, restore from last night's Sheet snapshot + Drive folder contents, and manually reconcile only the hours since. One-way syncs mean the mirror can never echo damage back into the source of truth.

---

*Canonical as of 14 Aug 2026. FigJam board: "Louis Pipeline v2" on file 7G5dzHNyRLDQ0WHqT6ORvO.*
