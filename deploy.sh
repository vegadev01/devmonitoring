#!/usr/bin/env bash
# Deploys / updates DevMonitor on the server. Safe to re-run.
#   First time:  git clone <repo> /opt/devmonitor && cd /opt/devmonitor && cp .env.example .env && (edit .env) && ./deploy.sh   # sudo is applied automatically
#   Updates:     ./deploy.sh        (pulls latest, rebuilds, restarts)
set -euo pipefail
cd "$(dirname "$0")"
# Needs root for docker/ufw. Re-run ourselves through sudo if started as a normal user.
if [ "$(id -u)" -ne 0 ]; then exec sudo bash "$0" "$@"; fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

say "Checking prerequisites"
if ! command -v docker >/dev/null 2>&1; then
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
  MYIP="$(curl -fsS4 https://api.ipify.org || true)"
  DNSIP="$(getent ahostsv4 "$HOST" | awk 'NR==1{print $1}' || true)"
  echo "server public IP: ${MYIP:-unknown}   DNS resolves to: ${DNSIP:-nothing}"
  if [ -n "$MYIP" ] && [ "$MYIP" != "$DNSIP" ]; then
    echo "WARNING: DNS does not point at this server yet. HTTPS certificate issuance will fail until it does." >&2
    read -r -p "Continue anyway? [y/N] " a; [ "${a:-n}" = "y" ] || exit 1
  fi
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Opening firewall ports ${HTTP_PORT:-80}/443"
  ufw allow "${HTTP_PORT:-80}"/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

if [ -d .git ]; then
  say "Pulling latest code"
  # pull as the repo's owner (root would hit git's 'dubious ownership' check)
  sudo -u "$(stat -c %U .)" git pull --ff-only
fi

say "Building and starting containers"
docker compose up -d --build --remove-orphans

say "Waiting for the API"
for i in $(seq 1 40); do
  if docker compose exec -T web wget -qO- http://api:4000/health 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  sleep 3
done
[ "${ok:-0}" = 1 ] || { docker compose logs --tail 40 api; die "API did not become healthy"; }

say "Waiting for $SITE (first HTTPS certificate can take ~30s)"
for i in $(seq 1 30); do
  if curl -fsS "$SITE/api/health" 2>/dev/null | grep -q '"ok":true'; then
    printf '\n\033[1;32mLive: %s\033[0m\n' "$SITE"; docker compose ps; exit 0
  fi
  sleep 4
done
docker compose logs --tail 30 caddy
die "Containers are up but $SITE is not answering yet — check the Caddy log above (usually DNS or ports 80/443)."
