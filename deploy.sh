#!/usr/bin/env bash
# Deploys / updates DevMonitor on the server. Safe to re-run.
#   First time:  git clone <repo> /opt/devmonitor && cd /opt/devmonitor && cp .env.example .env && (edit .env) && ./deploy.sh
#   Updates:     ./deploy.sh        (pulls latest, backs up the DB, rebuilds, restarts, verifies)
#
# Unattended use (GitHub Actions): runs as a user in the "docker" group without sudo, never prompts.
#   SKIP_PULL=1   deploy the code already checked out (the pipeline checks out the exact tested commit)
#   CI=true       non-interactive: no questions, warnings only
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

INTERACTIVE=1
if [ -n "${CI:-}" ] || [ ! -t 0 ]; then INTERACTIVE=0; fi

# Root is only needed to install Docker / open the firewall. A user in the docker group can deploy directly.
if [ "$(id -u)" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  if [ "$INTERACTIVE" = 1 ]; then exec sudo --preserve-env=SKIP_PULL,CI bash "$0" "$@"; fi
  sudo -n true 2>/dev/null || die "Cannot use Docker as $(id -un). Run once on the server: sudo usermod -aG docker $(id -un)  (then log out/in)"
  exec sudo -n --preserve-env=SKIP_PULL,CI bash "$0" "$@"
fi
AS_ROOT=0; [ "$(id -u)" -eq 0 ] && AS_ROOT=1

say "Checking prerequisites"
if ! command -v docker >/dev/null 2>&1; then
  [ "$AS_ROOT" = 1 ] || die "Docker is not installed (run ./deploy.sh once interactively to install it)"
  echo "Docker not found — installing"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is missing (apt install docker-compose-plugin)"

[ -f .env ] || die ".env not found. Run: cp .env.example .env  and fill it in."
chmod 600 .env
set -a; . ./.env 2>/dev/null || true; set +a   # only used for sanity checks below

problems=()
[ "${POSTGRES_PASSWORD:-change-me}" = "change-me" ] && problems+=("POSTGRES_PASSWORD is still the default")
[ "${SESSION_SECRET:-change-me-too}" = "change-me-too" ] && problems+=("SESSION_SECRET is still the default")
[ -z "${ADMIN_PASSWORD_HASH:-}" ] && problems+=("ADMIN_PASSWORD_HASH is empty (node api/scripts/hash-password.js \"pw\")")
case "${PUBLIC_WEB_URL:-}" in http://*|https://*) ;; *) problems+=("PUBLIC_WEB_URL must start with http:// or https://");; esac
if [ ${#problems[@]} -gt 0 ]; then
  printf ' - %s\n' "${problems[@]}" >&2
  die "Fix .env and re-run."
fi

SITE="${PUBLIC_WEB_URL%/}"
HOST="${SITE#*://}"; HOST="${HOST%%:*}"   # strip scheme and :port
if [[ "$HOST" =~ ^[0-9.]+$ ]]; then
  say "IP mode: serving plain HTTP on $SITE (no DNS / no certificate)"
else
  say "Checking DNS for $HOST"
  MYIP="$(curl -fsS4 --max-time 10 https://api.ipify.org || true)"
  DNSIP="$(getent ahostsv4 "$HOST" | awk 'NR==1{print $1}' || true)"
  echo "server public IP: ${MYIP:-unknown}   DNS resolves to: ${DNSIP:-nothing}"
  if [ -n "$MYIP" ] && [ "$MYIP" != "$DNSIP" ]; then
    echo "WARNING: DNS does not point at this server yet. HTTPS certificate issuance will fail until it does." >&2
    if [ "$INTERACTIVE" = 1 ]; then
      read -r -p "Continue anyway? [y/N] " a; [ "${a:-n}" = "y" ] || exit 1
    fi
  fi
fi

if [ "$AS_ROOT" = 1 ] && command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Opening firewall ports ${HTTP_PORT:-80}/443"
  ufw allow "${HTTP_PORT:-80}"/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

if [ -d .git ] && [ -z "${SKIP_PULL:-}" ]; then
  say "Pulling latest code"
  if [ "$AS_ROOT" = 1 ]; then
    # pull as the repo's owner (root would hit git's 'dubious ownership' check)
    sudo -u "$(stat -c %U .)" git pull --ff-only
  else
    git pull --ff-only
  fi
fi
[ -d .git ] && echo "Deploying commit $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

# Back up the database before migrations run, so a bad release can be recovered.
if [ -n "$(docker compose ps -q --status running db 2>/dev/null)" ]; then
  say "Backing up the database"
  mkdir -p backups
  BK="backups/predeploy-$(date -u +%Y%m%d-%H%M%S).sql.gz"
  if docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$BK"; then
    chmod 600 "$BK"
    echo "saved $BK ($(du -h "$BK" | cut -f1))"
    ls -1t backups/predeploy-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f   # keep the 10 most recent
  else
    rm -f "$BK"
    die "Database backup failed — aborting deploy so nothing is migrated without a backup"
  fi
fi

say "Building and starting containers"
docker compose up -d --build --remove-orphans

say "Waiting for the API"
for _ in $(seq 1 40); do
  if docker compose exec -T web wget -qO- http://api:4000/health 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  sleep 3
done
[ "${ok:-0}" = 1 ] || { docker compose logs --tail 40 api; die "API did not become healthy"; }

say "Waiting for $SITE (first HTTPS certificate can take ~30s)"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "$SITE/api/health" 2>/dev/null | grep -q '"ok":true'; then
    docker image prune -f >/dev/null 2>&1 || true   # reclaim space from replaced images
    printf '\n\033[1;32mLive: %s\033[0m\n' "$SITE"; docker compose ps; exit 0
  fi
  sleep 4
done
docker compose logs --tail 30 caddy
die "Containers are up but $SITE is not answering yet — check the Caddy log above (usually DNS or ports 80/443)."
