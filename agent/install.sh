#!/usr/bin/env bash
# Installs the Veganext DevMonitor agent as a systemd service.
# Usage (as printed by the dashboard when you add a server):
#   curl -fsSL <API_URL>/agent/install.sh | \
#     SERVER_ID="..." API_KEY="..." API_URL="..." bash
set -euo pipefail

: "${SERVER_ID:?SERVER_ID env var is required}"
: "${API_KEY:?API_KEY env var is required}"
: "${API_URL:?API_URL env var is required}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found. Install Node 18+ and re-run this script." >&2
  exit 1
fi

INSTALL_DIR="/opt/monitoring-agent"
mkdir -p "$INSTALL_DIR"
curl -fsSL "${API_URL}/agent/monitor-agent.js" -o "$INSTALL_DIR/monitor-agent.js"

cat > /etc/systemd/system/monitoring-agent.service <<EOF
[Unit]
Description=Veganext DevMonitor resource-reporting agent
After=network.target

[Service]
Type=simple
Environment=API_URL=${API_URL}
Environment=SERVER_ID=${SERVER_ID}
Environment=API_KEY=${API_KEY}
ExecStart=$(command -v node) ${INSTALL_DIR}/monitor-agent.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now monitoring-agent

echo "Installed and started monitoring-agent.service"
echo "Check status with: systemctl status monitoring-agent"
echo "Check logs with:   journalctl -u monitoring-agent -f"
