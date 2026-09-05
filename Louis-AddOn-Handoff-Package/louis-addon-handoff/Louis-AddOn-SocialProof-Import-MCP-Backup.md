# Louis Add-On — Social Proof, History Import, MCP & Backup
### Round 2 design notes, 4 Sep 2026. Feeds the Add-On Handoff Package.

---

## 1. Social proof in the first reply — status and design

**Do we have it?** Partly. The spec had a `{{testimonials_url}}` link in the proposal (E04) and an industry tag on the research brief, but no database of past clients or testimonials and no matching step. That is now designed and seeded:

- **`Testimonials` table** — seeded from `louis-testimonials-seed.csv`: **74 quotes** archived from bennemtin.com/testimonials (71 client/meeting-pro, 3 celebrity), each with name, title, company, **industry** (on the bookings-master taxonomy), **format** (14 explicitly virtual), category, source URL, an auto-generated short version, and an Active flag so Ben can retire or add quotes in Settings → Testimonials.
- **`Past Clients by Industry`** — seeded from `louis-past-clients-by-industry.csv`: **718 (industry, client) rows** derived from the bookings master: bookings count, last year, whether any were virtual. In the app this is a rollup on Companies, not a separate table; the CSV is the seed and the fallback.
- **Social-proof resolver** (a step in the drafts engine, no new worker): given the inquiry's industry (from the research brief or the form), it returns `industry_line` (one sentence: "Financial services groups are the audience I speak to most"), `related_clients_line` (3 to 5 names in the same industry, then adjacent industries, repeat clients and most recent first, virtual-matched if the inquiry is virtual), and **exactly one** testimonial matched on industry → format → recency. Ben's rule from his own sent mail is one quote, paired with the reel, never a wall of logos.
- **Where it lands: E01b, "Personal first reply with social proof."** Direct inquiries now go E01 auto-ack (seconds, Liezel) → **E01b** (within the hour, drafted for Ben, with related clients, one testimonial, the reel, a soft hold, and two call slots) → E03 if no slot lands → E04 proposal after the call. Bureau inquiries get the same proof block addressed to the agent.

**On the logo problem:** not an issue. The testimonials page prints the attribution as text under every quote (name, title, company), so company names are readable without the logo. Only three quotes carry a company but no person (Rocket Money, Boston Pizza, Fidelity/Justin Frye without a title); they're in the table as-is. The **Clients** page (bennemtin.com/clients) is logo-only, so it can't be scraped for names, but it doesn't need to be: the bookings master already gives 700 named clients with industry, which is a better source than a logo wall.

---

## 2. Importing 7 years of history — what's in the files and what to fix

**Bookings master (803 rows, 2019 to 2026, 700 unique clients, 55 repeat).**
Maps cleanly to: Companies (client_organization, industry, sub_industry), Deals (date/actual_event_date, event_name, event_theme, location, virtual, event_id as the import key, Closed-Won stage, Source = Bureau or Website/Direct), Bureau Companies (agreement_type), Contacts (contact_1/2/3 + contact_emails: **1,356 distinct emails**), and the questionnaire/notes fields (top_challenges, stress_notes, keynote_goal, problem_to_solve, email_insight → Client/Team Notes and Q-fields). This is the historical backfill their doc wanted, without touching the inboxes.

**Familiar list CRM (243 contacts, 190 companies).** Maps to Contacts with job title, phone (221), LinkedIn (144), title-then vs title-now, changed_company flag (23 moved, useful re-engagement targets), relevance rank and an outreach angle. Only **110 of 243 have an email** — the bookings master's contact_emails fills most of the gap on match by name + company.

**Issues the import run must handle (F11 mapping rules):**
1. **Bureau names need normalizing** — 116 raw labels collapse to ~107 and further with a synonym map (Keppler Speakers / Keppler Speakers Bureau; Washington Speakers Bureau / (WSB); Goodman / Goodman Speakers; Executive Speakers Bureau abbreviations). Seed the Bureau Company dropdown from the normalized list (this also answers the "[ADD BUREAU LIST]" gap in their doc).
2. **502 bureau vs 288 direct, 13 `needs_review`** — the split is more bureau-heavy than their 36/37% note; flag the 13 for Liezel.
3. **309 rows missing actual_event_date** — use `date` as the event date with a "date unverified" flag.
4. **189 rows "Other/Unclassified" industry** — run the company-enrichment worker on those companies post-import (Industry from URL) so social proof and re-engagement segmentation work.
5. **No fee data anywhere** — money stays blank on historical deals; Amount is not backfilled (their doc agrees: money is later).
6. **Dedupe** by event_id (deals), email (contacts), normalized company name + domain (companies). Two rows for a multi-day event stay two deals (Remax pattern).
7. **Attach everything with `Source = Import (bookings master 2026-09)`** in the audit log so a bad mapping can be rolled back as one batch.

Everything lands as Closed-Won (historical) or Closed Lost only where the sheet says so; contacts and companies become live CRM records immediately, which is what gives the app "access to the history" on day one and feeds the repeat-client rollups and journal history.

---

## 3. MCP connection to Louis — yes, build it

You can already reach the *data* through the Airtable connector. What's missing is the *app*: templates, settings, workers, queue, logs. A small **Louis MCP server** (an endpoint on the Vercel app, authenticated with the same Google SSO + role check) exposing admin tools:

- read: `get_deal`, `search`, `queue_summary`, `usage_meter`, `worker_status`, `recent_failures`, `template_get`
- write (admin only, audited): `template_update`, `setting_update`, `run_worker`, `retry_job`, `resolve_conflict`, `toggle_mode`, `add_user`

Every write goes through the same server-side RBAC and lands in the Audit Log as "via MCP (Jordan)". Scope it to admin roles, put it behind a per-user token you can revoke in Settings, and never expose money writes. Net effect: "Claude, change the T-14 questionnaire chase to T-10 and re-run the timers worker" is a one-line fix from chat, and the dev doesn't get pinged for config changes.

---

## 4. Is Airtable enough as a backup? Not alone. Keep three copies.

Airtable is the working system, not a backup. What's already specced: nightly Google Sheets snapshot (human-readable fallback, version history) and Drive for files. Add two things:

1. **Nightly full JSON export committed to a private GitHub repo** (`louis-data-backup`): every table, every field, one file per table. Git gives you immutable history, diffs (you can see exactly what changed on any night), free storage at this size, and a restore that's a script, not a spreadsheet exercise. This is the copy that survives an Airtable account problem, a bad import, or a rogue automation.
2. **Airtable base snapshots** on a monthly cadence (built-in, a few clicks), as the fastest same-platform restore.

Plus one process item: a **quarterly restore drill** where the dev restores last night's JSON into a scratch base and the app points at it for ten minutes. A backup nobody has restored from is a hope, not a backup.

That gives you 3 copies (Airtable, Sheets, Git) on 2 platforms (Google, GitHub) with one that's versioned and machine-restorable. A warm Postgres standby is possible but overkill at this scale; revisit if Louis ever serves multiple speakers from one deployment.

---

*Seeds delivered: `louis-testimonials-seed.csv` (74), `louis-past-clients-by-industry.csv` (718), `louis-email-templates.csv` (31, now incl. E01b).*
