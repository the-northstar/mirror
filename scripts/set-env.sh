#!/usr/bin/env bash
# Push this app's environment to Coolify, then redeploy.
#
# The deploy webhook in .github/workflows only triggers a build; it carries no
# variables, so these have to be set on the host. Reads them from .env rather
# than taking them inline, so no secret ends up in shell history.
#
#   COOLIFY_TOKEN=... ./scripts/set-env.sh
set -euo pipefail

HOST="${COOLIFY_HOST:-https://deploy.pykero.com}"
UUID="${COOLIFY_APP_UUID:-0tow6b0vl28lp4fbwapi0z55}"
: "${COOLIFY_TOKEN:?Set COOLIFY_TOKEN (Coolify: Keys & Tokens -> API tokens)}"

# Only what the app actually reads. YOUCAM_CLIENT_ID and YOUCAM_SECRET_KEY are
# deliberately absent: they belong to the legacy RSA flow v2.x does not use.
KEYS=(YOUCAM_API_KEY GEMINI_API_KEY CLERK_SECRET_KEY VITE_CLERK_PUBLISHABLE_KEY)

for key in "${KEYS[@]}"; do
  value=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    echo "skip  $key (not set in .env)"
    continue
  fi

  # VITE_ vars are inlined at build time, so they must exist as build args too
  # or the client bundle ships without them.
  is_build=false
  [[ "$key" == VITE_* ]] && is_build=true

  code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
    "$HOST/api/v1/applications/$UUID/envs" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"key\":\"$key\",\"value\":$(printf '%s' "$value" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"is_build_time\":$is_build,\"is_preview\":false}")

  # PATCH updates an existing var; POST creates one that is not there yet.
  if [ "$code" = "404" ] || [ "$code" = "400" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      "$HOST/api/v1/applications/$UUID/envs" \
      -H "Authorization: Bearer $COOLIFY_TOKEN" \
      -H 'Content-Type: application/json' \
      -d "{\"key\":\"$key\",\"value\":$(printf '%s' "$value" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"is_build_time\":$is_build,\"is_preview\":false}")
  fi
  echo "$code   $key$([ "$is_build" = true ] && echo '  (build-time)')"
done

echo
echo "redeploying..."
curl -s -X GET "$HOST/api/v1/deploy?uuid=$UUID" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | head -c 200
echo
echo "Then check:  curl https://<your-domain>/api/health"
