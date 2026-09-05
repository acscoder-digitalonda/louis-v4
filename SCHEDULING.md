# Scheduling the workers

Vercel Cron is **not** used. The Hobby plan caps crons at once per day, and F2 needs to
run every fifteen minutes — but more importantly, scheduling on the VPS is the better
shape anyway: the workers talk to Airtable, not to the app, so the app being down (or
mid-deploy, or rate-limited) must not stop intake.

Two ways to run them. Pick one; do not run both.

---

## Option A — run the workers on the VPS directly (recommended)

The VPS clones the repo and runs the worker CLI. Nothing depends on Vercel at all.

```bash
# on the VPS
git clone <repo> /opt/louis-v3 && cd /opt/louis-v3
npm ci
cp .env.example .env.local     # fill in Airtable, Gmail, OpenRouter
```

`crontab -e`:

```cron
# Louis v3 workers — cadence from Rebuild Spec §6
*/15 *  * * *  cd /opt/louis-v3 && npm run worker f2-email-intake  >> /var/log/louis/f2.log 2>&1
0     7  * * *  cd /opt/louis-v3 && npm run worker f6-timers        >> /var/log/louis/f6.log 2>&1
0     *  * * *  cd /opt/louis-v3 && npm run worker f9-mirror        >> /var/log/louis/f9.log 2>&1
0     8  * * *  cd /opt/louis-v3 && npm run worker f3-research      >> /var/log/louis/f3.log 2>&1
30    5  * * *  cd /opt/louis-v3 && npm run worker f13-qa-sweep     >> /var/log/louis/f13.log 2>&1
```

The CLI loads `.env.local` the same way the app does, exits non-zero on failure, and
emails an admin through the same `notifyWorkerFailure` path the scheduled route uses — so
a cron failure is not silent even if nobody reads the log.

**This needs `AI_BACKEND` set to `openrouter`** in Settings → AI unless the VPS also has
the `claude` binary. The Phase 0 runner shells out; OpenRouter does not.

## Option B — VPS cron hits the deployed endpoints

Keeps a single runtime (Vercel) and uses the VPS only as a clock. Slower to debug, and it
couples intake to the app being up — but it needs no Node on the VPS.

```cron
*/15 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/f2-email-intake
0    7 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/f6-timers
0    * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/f9-mirror
0    8 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/f3-research
30   5 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/f13-qa-sweep
```

`CRON_SECRET` is already set on the Vercel project. Read it with:

```bash
vercel env pull .env.vercel --environment production --scope team-digitalondas-projects
```

Serverless functions cap at 300s (`maxDuration` in the route), so a very large first
email backlog is better run once via Option A and then handed to the schedule.

---

## Do not run v2 and v3 against the same inbox

The existing `workers/` in the Onda Ops repo (v2) poll the **same** Gmail label
`louis-intake` and write to the **same** base `appNAaHVJMeTMbzdh`. They write to different
tables (`Events` / `Auto Updates` vs `Deals` / `Emails` / `Field Proposals`), so they will
not corrupt each other's rows — but every message would be ingested twice, into two
places, and you would have two answers to "what does the system know about this deal".

Before switching on F2 on the VPS, do one of:

- point v3 at a **new base** and a **new label** (`GMAIL_WATCH_LABEL=louis-v3-intake`), run
  both for a week, compare, then cut over; or
- stop the v2 scheduler container and let v3 own the inbox.
