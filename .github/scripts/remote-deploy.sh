#!/usr/bin/env bash
# Runs ON the production server (piped over SSH by the CI/CD workflow).
# Deploys exactly the tested commit; if the deploy fails its health checks, rolls back to the previous commit.
# Env: DEPLOY_PATH (repo on the server), SHA (commit to deploy)
set -euo pipefail
cd "${DEPLOY_PATH:?}"
: "${SHA:?}"

PREV="$(git rev-parse HEAD)"
git fetch --quiet origin
git reset --hard --quiet "$SHA"
echo "Deploying ${SHA:0:7} (currently running ${PREV:0:7})"

if CI=true SKIP_PULL=1 ./deploy.sh; then
  echo "::notice::Deployed ${SHA:0:7}"
  exit 0
fi

echo "::error::Deploy of ${SHA:0:7} failed its health checks — rolling back to ${PREV:0:7}"
git reset --hard --quiet "$PREV"
if CI=true SKIP_PULL=1 ./deploy.sh; then
  echo "::warning::Rolled back to ${PREV:0:7}. Database migrations from the failed release are not reverted; a pre-deploy backup is in $(pwd)/backups/"
else
  echo "::error::Rollback ALSO failed — the site may be down. SSH in and check: docker compose ps / docker compose logs"
fi
exit 1
