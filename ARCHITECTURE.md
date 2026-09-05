# Architecture

How the three spec documents map onto the code, and why the seams are where they are.

---

## 1. The shape

```
        website form                 Gmail (watched label)
             │                              │
             ▼                              ▼
      /api/intake/form              F2 email intake ──► F4 change handler
             │                              │                   │
             └──────────► F1 ◄──────────────┘        silent fill │ proposal
                           │                                     ▼
                           ▼                             Review Queue (human)
                    F5 stage engine ──► F7 drafts ──► Gmail draft ──► a person sends
                           │  ▲
                  F6 timers┘  └ F3 research     F9 mirror ──► Calendar/Docs/Sheets/Drive
                           │
                           ▼
                    ┌──────────────┐
                    │   AIRTABLE   │  ◄── the only database
                    └──────────────┘
                           ▲
                           │  REST, by field ID
                    ┌──────────────┐
                    │  Next.js app │  holds no state at all
                    └──────────────┘
```

The arrow that matters: **workers point at Airtable, not at the app.** That is what makes
the published Airtable interface a real fallback rather than a claim. If Vercel is down,
intake still files mail, timers still fire, and Liezel works the base directly.

## 2. The seams

Four, and only four, places where an implementation can be swapped without touching
anything else.

| Seam | File | Swap |
|---|---|---|
| Data | `src/lib/data/provider.ts` | `airtable` ⇄ `mock`. A third implementation would need no caller changes. |
| AI | `src/lib/gateway/index.ts` | `claude-code` ⇄ `openrouter`, per-tier models, fallback provider. A setting, not a deploy. |
| Mail | `src/lib/mailer.ts` | `gmail` ⇄ `console`. Client-facing copy only ever reaches *draft*. |
| Speaker | `speaker.config.ts` | The whole white-label story. |

Everything else is deliberately not pluggable. A seam you do not need is a seam that rots.

## 3. Where the spec lives in the code

| Spec | Code |
|---|---|
| Six stages, weighted forecast (Rebuild §2) | `speaker.config.ts` · `src/lib/forecast.ts` |
| F1 form intake | `src/workers/f1-form-intake.ts` · `src/app/api/intake/form/route.ts` |
| F2 email intake | `src/workers/f2-email-intake.ts` |
| F3 research + checker | `src/workers/f3-research.ts` |
| F4 change handler | `src/workers/f4-change-handler.ts` |
| F5 stage engine + packets | `src/workers/f5-stage-engine.ts` · `src/lib/stages.ts` |
| F6 timers | `src/workers/f6-timers.ts` |
| F7 drafts + checker | `src/workers/f7-drafts.ts` · `src/lib/templates.ts` |
| F8 money (no worker — lookups) | `src/lib/airtable/schema.ts` (`computed: true`) · `src/app/api/payments/[id]/route.ts` |
| F9 mirror | `src/workers/f9-mirror.ts` |
| F11 / F12 import & export | `src/workers/f11-import.ts` · `src/workers/f12-export.ts` |
| F13 QA sweep | `src/workers/f13-qa-sweep.ts` |
| Tier map, cap, usage meter (Rebuild §6, Handoff §7) | `src/lib/gateway/` · `src/components/settings/UsageMeter.tsx` |
| Roles & permissions (Rebuild §5) | `src/lib/rbac.ts`, enforced in every API route |
| Theming & tokens (Handoff §2) | `src/lib/theme.ts` · `src/app/globals.css` · `scripts/check-no-hex.mjs` |
| Tab IA (Handoff §3) | `src/app/(app)/deals/[id]/page.tsx` |
| Editability (Handoff §4) | `src/components/EditableField.tsx` + the PATCH routes |
| ⌘K search (Handoff §5) | `src/lib/search.ts` · `src/components/CommandPalette.tsx` |
| Mobile + PWA (Handoff §6) | `src/components/BottomTabs.tsx` · `src/app/manifest.webmanifest` |
| Notifications (Handoff §8) | `src/lib/notify.ts` · `src/components/NotificationBell.tsx` |
| White-label kit (Rebuild §8) | `speaker.config.ts` · `scripts/bootstrap-base.ts` · Templates table |

## 4. Field-ID binding

`src/lib/airtable/schema.ts` is the schema as code: table names, field names, types,
choices. `scripts/refresh-fields.ts` reads the live base and writes
`fields.generated.json`, mapping each domain key to a field **ID**. Reads then request
`returnFieldsByFieldId=true` and writes address fields by ID.

The fallback matters as much as the mechanism: when no generated map exists — a fresh
clone, CI, a base that has not been bootstrapped — everything falls back to field
*names* from the same schema file. The app compiles and runs either way, which is why CI
needs no credentials.

## 5. Why the mock provider exists

Three reasons, in order of importance:

1. A reviewer can clone the repo and see every screen in one command, before any
   credentials exist.
2. CI runs typecheck, lint and a full build with zero secrets. A pipeline that needs a
   secret to prove itself is a pipeline nobody can verify.
3. It keeps the data seam honest. Two implementations mean the interface cannot quietly
   grow Airtable-shaped assumptions.

It is explicitly not a database: writes live in process memory and vanish on restart.

## 6. The human-in-the-loop chain

This is the property the whole design exists to protect, so it is worth stating as a
single path:

```
model writes  →  cheaper model checks  →  status:proposed  →  Review Queue
                                                                   │
                                              human edits + approves│
                                                                   ▼
                                                 Gmail draft in the mailbox
                                                                   │
                                                 a person presses send
```

Four places enforce it, so removing one does not open the gate:

- `f7-drafts.ts` creates every draft as `proposed`.
- `/api/drafts/[id]` writes a Gmail **draft** on approve; `SEND_ON_APPROVE` is off by
  default and documented as the exception.
- `rbac.canApproveSends` gates who may approve at all.
- `notify.assertInternal` refuses to send notification mail outside the team domain, so
  automation cannot reach a client even by accident.

## 7. Costs and failure

Every gateway call writes a Usage Log row — including failures, which log an `err` row
with the message. Nothing is silent. The cap has a defined behaviour rather than a
crash: at 100% the non-critical tasks (`research`, `qa`, `draft`, `escalate`) throw
`GatewayPaused` while `classify`, `extract` and `check` keep running, so intake and
timers continue and only the expensive extras stop.

Worker failures always email an admin with the worker name and the log tail. "Something
broke" is not actionable; "F2 failed: Gmail token refresh 401" is.

## 8. What is deliberately not built

Named so nobody thinks they were missed:

- **A mapping screen for F11.** The importer detects a HubSpot export from its headers
  and runs a dry-run diff on the CLI. A UI for it is worth building once someone has
  imported twice and knows what they actually need to remap.
- **Doc and Sheet regeneration in F9.** Calendar and Drive push on change; Docs and
  Sheets are stubbed at the sweep, because regenerating a document on every keystroke is
  worse than regenerating it nightly.
- **The Opus weekly pipeline review.** The tier and the task type exist
  (`weekly-review`); nothing schedules it yet. It should run after a month of real Usage
  Log data, not before.
