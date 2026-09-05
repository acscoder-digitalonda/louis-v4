# LOUIS v3 — Data Holding Map
### Where every kind of data lives, held in separate domains
*Companion to `Louis-v3-Rebuild-Spec.md` §2. The rule underneath everything: **one owner per field, links between domains, never duplication.***

---

## The five domains (kept separate on purpose)

A contact is not a deal. A deal is not an order. Money is not operations. Files are not records. Each domain has its own tables, and domains connect **only by link fields** — so any one of them can be exported, rebuilt, or replaced without touching the others.

```
┌─────────────────────────────────────────────────────────────────┐
│  1. CRM / IDENTITY          who we know          (Louis base)   │
│  2. DEALS / OPERATIONS      what we're selling   (Louis base)   │
│  3. JOURNAL / MERCH         what we're shipping  (Louis base)   │
│  4. MONEY                   what we're owed/paid (Louis base —  │
│                             its own table group, permission-    │
│                             hidden, not a separate base)        │
│  5. ASSETS                  files                (Google Drive) │
└─────────────────────────────────────────────────────────────────┘
```

> **Decision (14 Aug 2026, deliberate override of the earlier "separate Cash base/login" locked decision):** Money merges into the Louis base as its own table group. Separation is by **permissions**, not by base. Rationale: everyone internal who touches the system already needs to see money (Liezel handles payments); the only true outsider is the accountant, who gets an **interface-only share** of the money screens and never sees the base. Merging deletes the cross-base chip-sync worker (old F8), removes the duplicated deals-money-view, and makes Payment/Contract status plain lookups — live by definition, no worker to break.

---

## Domain 1 — CRM / Identity (who)

**Tables: `Clients`, `Contacts`** — this is the CRM. It knows *people and companies*, and deliberately knows nothing about any specific deal.

| Table | Holds | Never holds |
|---|---|---|
| **Clients** | company name, industry, website, HQ, relationship notes, links to their Deals & Contacts | event dates, fees, logistics |
| **Contacts** | name, email, phone, **Type** (bureau agent · meeting planner · decision maker · onsite), agency name (if bureau), links to Client(s) and Deal(s), relationship history notes | anything deal-specific |

- One person, one record, forever — Jenna George links to every deal she's ever brokered across years. Her phone number lives in exactly one place.
- Bureau agents and direct buyers are **the same table, separated by Type**, surfaced as two distinct views ("Bureau Agents" / "Direct Buyers") so it reads like Connor's two tabs but dedupes like one CRM.
- The key-agent forward list is a flag on Contacts (`Key Agent ✓`), not a hardcoded list in a worker.
- *(If Attio stays in the stack per the earlier identity-sync design, it owns this domain and syncs one-way into these tables; if not, these tables ARE the CRM. Either way, nothing downstream changes — deals link to Contacts the same way.)*

## Domain 2 — Deals / Operations (what we're selling & delivering)

**Tables: `Deals`, `Tasks`, `Logistics Items`, `Drafts`, `Emails`, `Research Briefs`, `Audit Log`**

- **Deals** is the six-stage record (Inquiry → … → Debriefed). Event details (date, venue, AV, stage time, questionnaire answers, kickoff notes, post-keynote) are *sections of the deal*, populated as the deal matures — one record from first inquiry to debrief, never a copy-over between systems.
- The deal stores **links, not copies**: link to Client, links to 1–n Contacts (with a role-per-deal note like "onsite contact for this event"), links to its Journal Orders, its Drive folder URL, its money chips.
- `Emails` holds ingested message metadata + a Drive reference to the body — the raw record, never edited. `Drafts` is the outbound review queue. `Audit Log` records every AI/automation write. All link back to a deal.
- Multi-day events: one Deal row per day (the Remax pattern), linked to the same Client and Contacts.

## Domain 3 — Journal / Merch (what we're shipping)

**Table: `Journal Orders`** — the sidecar, physically separate from Deals.

- Fields: status (Mentioned → Promo Sent → Received → Interested → Bulk Ordered → Shipped → Dropship), quantity, ship-to, ship-by date, warehouse notes, inserts flag.
- Links: → Deal (optional!) and → Client. **Optional matters:** Amazon tail sales, Instagram orders, and post-event attendee dropships can exist with a Client link but *no* deal — the journal business isn't forced through the keynote pipeline.
- One keynote → many orders (promo, bulk, dropship) as separate rows, so journal revenue per event is a rollup, not a field someone maintains.

## Domain 4 — Money (Louis base — its own table group, permission-hidden)

**Tables: `Payments`, `Schedule Legs`** (+ money fields owned on `Deals`: fee, invoice refs, payment schedule link).

- No more duplicated "deals money view" — the Deal record IS the deal; money attaches to it via its own tables and money-owned fields.
- **Ownership by table, not by base:** Payments and Schedule Legs are money's tables; nothing outside the money group ever writes them. Payment Status and Contract Status on the deal are **lookups/rollups from Payments** — read-only everywhere, live by definition, no sync worker (old F8 deleted from the function map).
- Payments remain **human-confirmed only** — the bank/QuickBooks matcher proposes, a person confirms. Unchanged.
- **Permissions do the separating:** accountant = interface-only collaborator on a published Money interface (Payments ledger, Owed/Received/Net, forecast) — she never sees the base or any ops/CRM table. Ben = chips-only by default, amounts via Settings toggle. Liezel/Jordan = full. The Vercel skin enforces the same gates server-side on its money tiles.
- The weighted pipeline forecast (0/25/65/100) stays an operations formula on stage; Owed/Received/Net math stays in the money tables. Same one-owner principle, one base.
- Nightly snapshot gains a Money tab in the same Sheet — one backup covering everything.

## Domain 5 — Assets (Google Drive is primary; Airtable stores references)

**The rule: files live in Drive, records point at them.** Airtable attachment fields are used only for tiny convenience items (a logo thumbnail); anything real gets a Drive URL. This keeps the base light, keeps version history on files, and means assets survive any app failure.

Drive structure (auto-created by the mirror worker):

```
/Louis
├── /Speaker Assets                ← the permanent library (Resources table points here)
│   bio, headshots, speaker reels, testimonials doc, AV rider, rate card, journal video
├── /Deals
│   └── /2026 — McKee Foods — Jul 17     ← one folder per deal, made at Sales entry
│       ├── /Received      contracts, client logos, brand files, run-of-show, NDAs
│       ├── /Sent          proposal PDF, welcome kit, field guide copy
│       ├── /Decks         event deck (+ links into the master deck library)
│       ├── /Emails        ingested bodies + attachments (audit copies)
│       └── Event Doc      the regenerated Google Doc mirror of the record
├── /Deck Library                  ← all decks across clients (existing pattern)
└── /Snapshots                     ← nightly Sheets exports per table group
```

- **Assets we GET** (contracts, logos, brand kits, signed NDAs, questionnaire attachments) → the deal's `/Received` folder, referenced from the deal's Contract & Client Assets section.
- **Assets we NEED/SEND** (proposal, kit, rate card) → assembled from `/Speaker Assets` templates into the deal's `/Sent` folder — so every deal folder is a complete self-contained record of the engagement.
- NDA-restricted clients: the exception flow is *delete the Drive subfolder + strip flagged fields* — possible precisely because files aren't scattered inside the base.

---

## Where everything else is held (the non-Airtable surfaces)

| Surface | Holds | Direction |
|---|---|---|
| **Google Calendar** | holds & events, color-coded by stage | Louis → Calendar |
| **Google Sheets** | nightly snapshot per domain (CRM sheet, Deals sheet, Journal sheet) — separate tabs so Liezel's fallback mirrors the same separation | Louis → Sheets |
| **Google Docs** | one readable Event Doc per deal, regenerated on change | Louis → Docs |
| **Gmail** | outbound drafts (from the Drafts engine) + live threads | two-way (drafts written; inbound watched) |
| **Airtable Money interface** | the accountant's whole world — published money screens only, never the base | read-only share |
| **Vercel app** | **nothing.** The skin holds zero state — it reads/writes Airtable live. This is what makes the Airtable-interface fallback real. |

## Export shape & portability standard (HubSpot-conformant)

**How the nightly snapshot is arranged:** one Google Sheet, one tab per domain (Clients · Contacts · Deals · Journal Orders · Money), columns = Airtable field names, one row per record, links flattened to linked-record names + IDs. This is the *backup* shape — Louis-native, complete.

**The portable shape:** internal field names stay Louis-native (ops fields like AV Check Time have no CRM equivalent), but F12 also emits a **HubSpot-standard export profile** — three files matching HubSpot's import objects, generated from a stored two-way Mapping. HubSpot shape = lingua franca: Attio, Pipedrive, and Salesforce importers accept it with minimal remapping.

| File | Headers (HubSpot labels) | Dedupe key |
|---|---|---|
| `companies.csv` | Company Name · **Company Domain Name** · Industry · City · Country/Region · Description | Company Domain Name |
| `contacts.csv` | First Name · Last Name (split from Name at export) · **Email** · Phone Number · Job Title · Company Name · Company Domain Name (association) · Contact Type* · Key Agent* | Email |
| `deals.csv` | Deal Name · Pipeline ("Keynote") · Deal Stage (our six stages as a custom pipeline) · Amount (plain number) · Close Date · Deal Type · Associated Company Domain · Associated Contact Emails (semicolon-sep) · Event Date* · Location* | Airtable Record ID |

*\* = custom properties, created on target platform at import.*

**Formatting rules (all files):** ISO dates `YYYY-MM-DD` · UTF-8 · semicolons for multi-values · no currency symbols · every file carries an `Airtable Record ID` column so exports **round-trip** (F11 re-imports match on ID, never guess). Journal Orders export as their own CSV (no native HubSpot object; becomes a second pipeline or custom object if ever pushed to a CRM). The Mapping runs both directions — F11 accepts a raw HubSpot export natively.

**One schema addition this requires:** capture **Company Domain** on every Client from now on (derivable from contact email domains for existing records; the F13 QA sweep flags clients missing it).

## Cross-domain rules (for the build agent)

1. Every cross-domain relationship is a **link field**, never a copied value. Lookups/rollups render foreign data read-only.
2. **One owner per field.** If two systems could write it, decide the owner now and make the other a read-only lookup.
3. All syncs **one-way**. No echo loops, no conflict class.
4. Each domain exports independently (its own Sheet tab, its own CSV) — the platform-exit guarantee applies per-domain.
5. New speaker (white-label kit) = clone all five domains empty; only `/Speaker Assets` and the script bank get filled during setup.

---
*Data map canonical, 14 Aug 2026. Diagram: "Louis v3 — Data Holding Map" on the FigJam board.*
