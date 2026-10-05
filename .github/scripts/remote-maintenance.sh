#!/usr/bin/env bash
# Weekly server housekeeping, run ON the server over SSH by the Maintenance workflow.
# Prints a Markdown report on stdout (shown in the workflow summary). Exit code 1 = needs attention.
set -uo pipefail
cd "${DEPLOY_PATH:?}" || exit 1
DISK_LIMIT="${DISK_LIMIT:-85}"
status=0

echo "### Server: $(hostname) — $(date -u '+%Y-%m-%d %H:%M UTC')"
echo
echo "| Check | Result |"
echo "|---|---|"
disk=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "$disk" -ge "$DISK_LIMIT" ]; then echo "| Disk usage (/) | ❌ ${disk}% (limit ${DISK_LIMIT}%) |"; status=1; else echo "| Disk usage (/) | ✅ ${disk}% |"; fi
mem=$(free -m | awk '/Mem:/ {printf "%d%% of %d MB", ($3/$2)*100, $2}')
echo "| Memory in use | ${mem} |"
echo "| Load average | $(cut -d' ' -f1-3 /proc/loadavg) |"
echo "| Uptime | $(uptime -p) |"
echo "| Deployed commit | \`$(git rev-parse --short HEAD)\` $(git log -1 --format=%s | sed 's/|/\\|/g') |"

# Anything not running, or running but failing its Docker health check.
unhealthy=$(docker compose ps -a --format '{{.Service}} {{.State}} {{.Health}}' | awk '$2 != "running" || $3 == "unhealthy" {print $1 " (" $2 ($3 ? ", " $3 : "") ")"}')
running=$(docker compose ps --status running -q | wc -l)
if [ -n "$unhealthy" ]; then echo "| Containers | ❌ $(echo "$unhealthy" | tr '\n' ';') |"; status=1; else echo "| Containers | ✅ ${running} running |"; fi

health=$(docker compose exec -T web wget -qO- http://api:4000/health 2>/dev/null || echo '{"ok":false}')
if echo "$health" | grep -q '"ok":true'; then echo "| API /health | ✅ ok |"; else echo "| API /health | ❌ \`${health}\` |"; status=1; fi

dbsize=$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_size_pretty(pg_database_size(current_database()))"' 2>/dev/null | tr -d '\r')
echo "| Database size | ${dbsize:-unknown} |"

# Weekly backup (kept 8 weeks) in addition to the pre-deploy backups.
mkdir -p backups
bk="backups/weekly-$(date -u +%Y%m%d).sql.gz"
if docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$bk" && [ -s "$bk" ]; then
  chmod 600 "$bk"
  ls -1t backups/weekly-*.sql.gz | tail -n +9 | xargs -r rm -f
  echo "| Weekly DB backup | ✅ ${bk} ($(du -h "$bk" | cut -f1)), $(ls backups/*.sql.gz | wc -l) backups kept |"
else
  rm -f "$bk"; echo "| Weekly DB backup | ❌ pg_dump failed |"; status=1
fi

before=$(docker system df --format '{{.Size}}' | head -1)
docker image prune -f >/dev/null 2>&1
docker builder prune -f --filter until=168h >/dev/null 2>&1
echo "| Docker cleanup | images were ${before}; pruned dangling images and build cache older than 7 days |"
echo
echo "<details><summary>docker system df</summary>"
echo
echo '```'
docker system df
echo '```'
echo "</details>"
exit $status
