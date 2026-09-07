#!/usr/bin/env bash
#
# CI, then deploy, then alias — and stop at the first thing that fails.
#
# This exists because the obvious one-liner is wrong in a way that looks right:
#
#     npm run ci | grep -E "pass|fail" && npx vercel --prod
#
# The exit status of a pipeline is the *last* command's, so a red CI whose output
# still contains a matching line hands grep an exit 0 and `&&` deploys anyway.
# It happened twice in one day; both builds failed at Vercel's own lint step, which
# is the only reason neither reached production.
#
#   ./scripts/ship.sh            CI, deploy, alias
#   ./scripts/ship.sh --dry      CI only

set -euo pipefail

ALIAS="${LOUIS_ALIAS:-louis-v3.vercel.app}"

echo "── CI ─────────────────────────────────────────────"
npm run ci
echo "CI passed."

if [[ "${1:-}" == "--dry" ]]; then
  echo "Dry run: not deploying."
  exit 0
fi

echo
echo "── Deploy ─────────────────────────────────────────"
# Captured rather than piped, so the exit status is the deploy's own. The URL is grepped
# out rather than taken from the last line: the CLI's final line is sometimes a closing
# brace of its own JSON, which `tail -1` cheerfully returns as the deployment URL.
out="$(npx vercel --prod --yes 2>&1)"
url="$(grep -oE 'https://[a-z0-9.-]+\.vercel\.app' <<<"$out" | tail -1)"
[[ -n "$url" ]] || { echo "$out"; echo "No deployment URL in that output."; exit 1; }
echo "Built $url"

# `vercel --prod` on a linked project aliases the production domain itself, so this only
# has work to do when it did not.
if ! grep -q "Aliased" <<<"$out"; then
  echo
  echo "── Alias ──────────────────────────────────────────"
  npx vercel alias set "${url#https://}" "$ALIAS"
fi

echo
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$ALIAS/signin")"
echo "https://$ALIAS/signin -> $code"
[[ "$code" == "200" ]] || { echo "The alias is not serving. Check the deployment."; exit 1; }
