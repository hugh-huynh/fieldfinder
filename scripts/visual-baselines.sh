#!/usr/bin/env bash
# Regenerates the screenshot baselines (tests/e2e/visual.spec.ts, PR 3.13) in Playwright's official
# Linux image, so they match CI's ubuntu-24.04 runner. Run only after the screens have been reviewed:
#
#   pnpm db:start                          # the LOCAL Supabase stack, seeded
#   pnpm e2e:visual:update                 # regenerate; review the changed PNGs in git before committing
#   bash scripts/visual-baselines.sh --check  # compare against the committed baselines instead
#
# - Host networking: the container reaches the LOCAL database and storage at 127.0.0.1, as the app
#   does in E2E (playwright.config.ts). Nothing hosted is touched.
# - node_modules and .next live in Docker volumes, so the Mac's native packages are never replaced.
# - The local storage keys come from `supabase status` here and go in by name (never printed).
set -euo pipefail

MODE="--update-snapshots"
if [ "${1:-}" = "--check" ]; then MODE=""; shift; fi

cd "$(dirname "$0")/.."
VERSION="$(node -p 'require("@playwright/test/package.json").version')"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"

status="$(node_modules/.bin/supabase status -o env)"
pick() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" <<<"$status"; }
export SUPABASE_S3_REGION="$(pick S3_PROTOCOL_REGION)"
export SUPABASE_S3_ACCESS_KEY_ID="$(pick S3_PROTOCOL_ACCESS_KEY_ID)"
export SUPABASE_S3_SECRET_ACCESS_KEY="$(pick S3_PROTOCOL_ACCESS_KEY_SECRET)"
for name in SUPABASE_S3_REGION SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY; do
  [ -n "${!name}" ] || { echo "visual-baselines: \`supabase status\` gave no ${name}; is \`pnpm db:start\` running?" >&2; exit 1; }
done

docker run --rm --network host --ipc host \
  -v "$PWD:/work" -w /work \
  -v fieldfinder-visual-node-modules:/work/node_modules \
  -v fieldfinder-visual-next:/work/.next \
  -v fieldfinder-visual-pnpm-store:/root/.local/share/pnpm \
  -e E2E_DB=1 -e FF_LOCAL_S3_FROM_ENV=1 -e CI= -e MODE="$MODE" \
  -e SUPABASE_S3_REGION -e SUPABASE_S3_ACCESS_KEY_ID -e SUPABASE_S3_SECRET_ACCESS_KEY \
  "$IMAGE" bash -euo pipefail -c '
    # The image'"'"'s Node has no corepack (Node 25+): install the pinned pnpm from package.json.
    npm install -g --silent "$(node -p "require(\"./package.json\").packageManager")"
    pnpm install --frozen-lockfile --reporter=silent
    pnpm exec playwright test tests/e2e/visual.spec.ts --project=desktop-chromium --project=mobile-chromium $MODE "$@"
  ' _ "$@"
