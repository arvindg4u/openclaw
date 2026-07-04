#!/bin/bash
set -euo pipefail

# Render free tier entrypoint
# Restores OpenClaw state from R2 on startup
# Runs background backup loop
# Initializes OpenClaw if first-run, then starts gateway

R2_BUCKET="${R2_BUCKET:-openclaw-backup}"
R2_PREFIX="${R2_PREFIX:-openclaw-state}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
CONFIG_FILE="${STATE_DIR}/openclaw.json"

# Ensure rclone is available
if ! command -v rclone &>/dev/null; then
  echo "==> rclone not found, installing via curl..."
  curl -fsSL https://rclone.org/install.sh | bash
fi

rclone_configured() {
  [ -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" ] && [ -n "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:-}" ]
}

# Step 1: Restore state from R2 if available
if rclone_configured; then
  echo "==> Restoring OpenClaw state from R2..."
  if rclone lsd "r2:" 2>/dev/null | head -1 >/dev/null 2>&1 && \
     rclone ls "r2:${R2_BUCKET}/${R2_PREFIX}/latest/" 2>/dev/null | head -1 >/dev/null 2>&1; then
    mkdir -p "$STATE_DIR"
    rclone sync "r2:${R2_BUCKET}/${R2_PREFIX}/latest/" "$STATE_DIR/" \
      --exclude "node_modules/**" --exclude ".git/**"
    echo "==> State restore complete."
  else
    echo "==> No existing backup found or R2 unreachable. Starting fresh."
  fi
else
  echo "==> R2 credentials not configured. Skipping restore."
fi

# Step 2: Create initial config if missing (required for first run)
if [ ! -f "$CONFIG_FILE" ]; then
  echo "==> Creating initial OpenClaw config..."
  mkdir -p "$STATE_DIR"
  cat > "$CONFIG_FILE" << 'CONFIGEOF'
{
  "gateway": {
    "mode": "remote",
    "port": 8080,
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "__GATEWAY_TOKEN__"
    },
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true
    }
  }
}
CONFIGEOF
  # Substitute the actual gateway token
  if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
    sed -i "s/__GATEWAY_TOKEN__/${OPENCLAW_GATEWAY_TOKEN}/" "$CONFIG_FILE"
  else
    sed -i "s/__GATEWAY_TOKEN__/render-$(openssl rand -hex 16)/" "$CONFIG_FILE"
  fi
  echo "==> Initial config created."
fi

# Step 3: Start background backup loop
if rclone_configured; then
  echo "==> Starting backup loop..."
  /app/scripts/r2-background-backup.sh &
  echo "==> Backup loop running (PID $!)"
fi

# Step 4: Start OpenClaw gateway (foreground)
echo "==> Starting OpenClaw gateway..."
exec node /app/openclaw.mjs gateway --allow-unconfigured
