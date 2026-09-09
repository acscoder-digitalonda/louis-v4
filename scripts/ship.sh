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
sha="$(git rev-parse --short HEAD)"
git push origin main
echo "Pushed $sha. Vercel builds from GitHub."

echo
echo "── Wait for Vercel ────────────────────────────────"
# The newest deployment row, once its commit matches ours, tells us the outcome.
for _ in $(seq 1 60); do
  row="$(npx vercel ls "$PROJECT" 2>/dev/null | sed -n '6p' || true)"
  if grep -q "Ready" <<<"$row"; then
    echo "Ready: $(grep -oE 'https://[a-z0-9.-]+\.vercel\.app' <<<"$row" | head -1)"
    break
  fi
  if grep -qE "Error|Blocked|Canceled" <<<"$row"; then
    echo "$row"
    echo "Vercel did not deploy this push. Open the deployment for the reason."
    exit 1
  fi
  sleep 10
done

echo
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$ALIAS/signin")"
echo "https://$ALIAS/signin -> $code"
[[ "$code" == "200" ]] || { echo "The alias is not serving. Check the deployment."; exit 1; }
