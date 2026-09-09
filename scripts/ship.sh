#!/usr/bin/env bash
#
# CI, then push, then wait for Vercel to build from GitHub — stopping at the first failure.
#
# Deploys go through the GitHub integration now: a push to main is the deploy. Two things
# this script still has to guarantee that the integration does not:
#
#   1. The test suite runs *before* the push. Vercel's build runs `next build` (typecheck
#      and lint) but not the tests, and GitHub Actions runs them only after Vercel has
#      already started building. So the gate is here, and it is a real exit code — not a
#      pipe into grep, which is how two red builds once committed and reported as shipped.
#   2. The commit author is an email GitHub knows. Vercel blocks a deployment whose
#      author it cannot match to a team member; thirty-five commits made with an
#      override email were blocked in one afternoon. Never pass `-c user.email` here.
#
#   ./scripts/ship.sh            CI, push, wait, verify
#   ./scripts/ship.sh --dry      CI only

set -euo pipefail

ALIAS="${LOUIS_ALIAS:-louis-v3.vercel.app}"
PROJECT="${LOUIS_VERCEL_PROJECT:-louis-v3}"

echo "── CI ─────────────────────────────────────────────"
npm run ci
echo "CI passed."

if [[ "${1:-}" == "--dry" ]]; then
  echo "Dry run: not pushing."
  exit 0
fi

email="$(git config user.email)"
if [[ "$email" != *"@"* ]] || [[ "$email" == "team@digitalonda.com" ]]; then
  echo "Commit author email is '$email', which Vercel will not match to a GitHub account."
  exit 1
fi

echo
echo "── Push ───────────────────────────────────────────"
GIT_MAIN="louis-v3-git-main-team-digitalondas-projects.vercel.app"
# What the branch domain serves *before* the push: the wait below is for it to change.
# `2>&1`, not `2>/dev/null`: the CLI prints inspect output on stderr, and with it silenced
# the loop read an empty url for ever and hung for the full fifteen minutes. Twice.
# Matching "Ready" in the listing is not enough — the row it matches is the last deploy.
before="$(npx vercel inspect "$GIT_MAIN" 2>&1 | awk '/^\s*url/ {print $2}' || true)"
sha="$(git rev-parse --short HEAD)"
git push origin main
echo "Pushed $sha. Vercel builds from GitHub."

echo
echo "── Wait for Vercel ────────────────────────────────"
for _ in $(seq 1 60); do
  now="$(npx vercel inspect "$GIT_MAIN" 2>&1 || true)"
  url="$(awk '/^\s*url/ {print $2}' <<<"$now")"
  status="$(awk '/^\s*status/ {print $0}' <<<"$now")"
  if [[ -n "$url" && "$url" != "$before" ]]; then
    if grep -q "Ready" <<<"$status"; then echo "Ready: $url"; break; fi
    if grep -qE "Error|Blocked|Canceled" <<<"$status"; then
      echo "$status"; echo "Vercel did not deploy this push. Open $url for the reason."; exit 1
    fi
  fi
  sleep 10
done

echo
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$ALIAS/signin")"
echo "https://$ALIAS/signin -> $code"
[[ "$code" == "200" ]] || { echo "The alias is not serving. Check the deployment."; exit 1; }
