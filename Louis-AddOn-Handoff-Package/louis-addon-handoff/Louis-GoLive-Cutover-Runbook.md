# Louis Go-Live Cutover Runbook
### Strip the sample data, load the history, seed the live pipeline from Ben's calendar and both inboxes, then flip intake on
*4 Sep 2026. Work package WP4.3 in `Louis-AddOn-Run-Plan.md`. Fable supervises; Opus runs the calendar and inbox extraction; Liezel and Ben approve.*

**The fact that shapes this plan:** the 21 Jul 2026 bookings master ends on 14 Jul 2026. It has **no future rows**. It seeds history only. The live pipeline has to be rebuilt from three sources that are not in any spreadsheet: Ben's Google Calendar, Ben's and Liezel's mailboxes, and Liezel's tracking sheets.

---

## Phase A — Freeze and purge (dev, 1 hour)
1. Export the sample base as-is (JSON, one file per table) into the repo as `fixtures/sample-2026-09/` so the sample data survives as test fixtures.
2. Delete all *records* in every domain table (Deals, Companies, Contacts, Line Items, Fulfillment, Payments, Schedule Legs, Emails, Drafts, Tasks, Notifications, Audit Log, Usage Log, Date Conflicts). Keep every *config* table intact: Templates, Rate Cards, Products, Testimonials, Mail Accounts, Users, Settings, Bureau Companies.
3. Verify `fields.ts` is unchanged (purging records never touches schema). Confirm the app renders empty states, not errors.

## Phase B — History load (WP4.2, already planned)
4. Dry-run the bookings master (803 rows) and familiar list (243) through F11 with the mapping in `Louis-AddOn-SocialProof-Import-MCP-Backup.md` §2 and the reclassified industries. Fable reviews the diff. Live run. All rows tagged `Source = Import (bookings master 2026-09)`; deals land as **Delivered (historical)** with a `Historical ✓` flag so they never enter timers or digests.
5. Result: 700 companies, ~1,400 contacts, 803 historical deals, normalized bureau list, journal rollups and repeat-client counts live.

## Phase C — Forward seed: the one-time reverse read
*This is the single, deliberate exception to "the calendar is a render, not a source." It runs once, before the one-way mirror is switched on, and everything it produces is a proposal.*

**C1 · Calendar read (Opus).** Read Ben's calendar from **1 Jun 2026** (to catch anything delivered between the scrape and go-live) through **+18 months**. For every event, classify by the team's own conventions: colour, "HOLD" wording, the (2)/(3) numbering, "CONFIRMED", virtual markers. Propose a Deal per event with: client (fuzzy-matched to the imported Companies; new company if no match), event date, location, lane (bureau agent in the title → Bureau, agent name → Contact), and stage: confirmed → **Closed-Won** or **Pre-Event** by date; hold → **Qualified**, with Hold Order taken from the numbering or, failing that, the calendar event's creation time; multiple holds on one date → a Date Conflict record, Open, for Ben. Delivered since 14 Jul → Delivered (historical). Every proposal carries a confidence and the source event ID.

**C2 · Inbox sweep (Opus intent read, Sonnet extraction).** Sweep both mailboxes from **1 Jun 2026** using the delegated service account. Extract in-flight threads: inquiries, proposals with fees quoted, decision dates stated, contracts sent/signed, invoices, kits sent, questionnaires returned, journal conversations, bureau agent check-ins. Attach each thread to the calendar-derived deal it belongs to (client + date); where a thread has no calendar hold, propose a new **Inquiry** or **Qualified** deal. Fill Sales fields (negotiated fee, decision date, proposal-sent), Logistics fields, and Contract/Payment status where the emails say so. New bureau agents and client contacts become Contact proposals. Everything is a proposal.

**C3 · Liezel's sheets.** The four tracking sheets and the Released Inquiries sheet (Liezel to provide; the SpeakerOS doc flags them as awaited) reconcile against C1/C2: fill logistics, hotel/travel, payment status, and mark released inquiries as **Closed Lost** with a reason so re-engagement can find them. Column mapping saved as a reusable Mapping.

**C4 · QuickBooks.** For every proposed Closed-Won/Pre-Event deal, read invoices and payments (read-only) into Payments/Schedule Legs proposals. Liezel confirms each payment; nothing is marked Paid by a machine.

**C5 · Reconciliation session (Liezel + Ben, ~90 min).** The Review Queue opens in **batch mode**: a single table of every proposed deal with client, date, stage, lane, fee, hold order, sources, confidence, and any conflict. Accept, merge, edit, or dismiss per row; bulk-accept the high-confidence set. Expected volume at Ben's pace: roughly 30 to 60 upcoming deals plus a handful of open inquiries. Date Conflicts are resolved here by Ben, including "both feasible." No deal exists in Louis until a human accepted it.

## Phase D — Flip the calendar
6. Create the **Louis Holds** calendar from Airtable (one-way mirror on). Every accepted deal renders as a hold or confirmed booking, colour by stage.
7. Move the old hand-made hold/booking events on Ben's personal calendar to an **"Archive (pre-Louis)"** calendar, hidden by default, so the two never disagree and nothing is deleted. From this point a hold typed straight onto the calendar is flagged by the integrity sweep, never imported.

## Phase E — Verify, then go live (dev + Fable, same day)
8. Counts reconcile: accepted deals = Louis Holds events; every upcoming deal has a Next Action and an owner; every Pre-Event deal has kit/questionnaire/kick-off state set correctly by the compressed timers ("at T-x or immediately if passed" fires whatever is already due, in order).
9. Road Warrior fires for the nearest event (dry run to Jordan first, then to Ben). Staleness digest baseline sent. Sheets snapshot #1 and Git backup #1 committed.
10. Switch intake workers to live (6-minute detect, 30-minute think). Mode dial on **LAUNCH**. Failover drill already passed in staging.
11. Two-week watch: Liezel works from Louis and the Review Queue only; sheets stay as read-only fallback. Fable's weekly review reports anything the seed missed (a thread with no deal, a hold with no thread).

---

## What Jordan/Liezel/Ben need to provide before Phase C
- Workspace admin grant for domain-wide delegation (one grant, all bennemtin.com mailboxes).
- Ben's calendar shared to the service account (read) and the naming/colour conventions written down in five lines.
- Liezel's four tracking sheets + the Released Inquiries sheet.
- QuickBooks read-only connection.
- A 90-minute reconciliation slot with Liezel and Ben.

## Rollback
Every phase writes to the Audit Log with a batch ID (`import-history-2026-09`, `seed-calendar-2026-09`, `seed-inbox-2026-09`, `seed-sheets-2026-09`). Any batch can be reversed as a unit. The sample fixtures can be reloaded for testing at any time from the repo.
