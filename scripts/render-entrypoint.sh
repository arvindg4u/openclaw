#!/bin/bash
set -euo pipefail

# Render free tier entrypoint
# Restores state from R2, starts ttyd web terminal + OpenClaw, routes via Caddy

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
    echo "==> No existing backup found. Starting fresh."
  fi
fi

# Step 2: Create / patch OpenClaw config
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-render-$(openssl rand -hex 16)}"
export GATEWAY_TOKEN CONFIG_FILE STATE_DIR
mkdir -p "$STATE_DIR"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "==> Creating initial OpenClaw config..."
  node -e "
    const fs = require('fs');
    const config = {
      gateway: {
        mode: 'remote',
        port: 18789,
        bind: 'lan',
        auth: { mode: 'token', token: process.env.GATEWAY_TOKEN },
        controlUi: { enabled: true, allowInsecureAuth: true, dangerouslyDisableDeviceAuth: true, allowedOrigins: ['https://openclaw-cg79.onrender.com'] },
      }
    };
    fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  "
  echo "==> Initial config created."
fi

# Re-patch config on every start
node -e "
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf-8'));
  const origin = 'https://openclaw-cg79.onrender.com';
  cfg.gateway = cfg.gateway || {};
  cfg.gateway.port = 18789;
  cfg.gateway.bind = 'lan';
  const cu = cfg.gateway.controlUi || {};
  const origins = cu.allowedOrigins || [];
  if (!origins.includes(origin)) origins.push(origin);
  cfg.gateway.controlUi = { ...cu, allowedOrigins: origins, allowInsecureAuth: true, dangerouslyDisableDeviceAuth: true };
  fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
"

# Step 3: Start background backup loop
if rclone_configured; then
  echo "==> Starting backup loop..."
  /app/scripts/r2-background-backup.sh &
fi

# Step 4: Start ttyd web terminal (port 7681)
echo "==> Starting ttyd web terminal on port 7681..."
ttyd --port 7681 --interface 127.0.0.1 --writable bash &
TTYD_PID=$!
echo "==> ttyd PID $TTYD_PID"

sleep 1

# Step 5: Start OpenClaw gateway (background, port 18789)
echo "==> Starting OpenClaw gateway on port 18789..."
node /app/openclaw.mjs gateway --allow-unconfigured &
OPENCLAW_PID=$!

# Wait for gateway ready
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    echo "==> OpenClaw ready after ${i}s."
    break
  fi
  sleep 1
done

# Step 6: Start Caddy reverse proxy (foreground, port 8080)
echo "==> Starting Caddy reverse proxy on port 8080..."
cat > /tmp/Caddyfile << 'CADDYEOF'
:8080 {
    handle_path /terminal/* {
        reverse_proxy localhost:7681
    }
    handle /terminal {
        redir /terminal/ 308
    }
    handle /health {
        header Content-Type "text/plain"
        respond "OK" 200
    }
    handle /healthz {
        header Content-Type "text/plain"
        respond "OK" 200
    }
    handle {
        reverse_proxy localhost:18789
    }
}
CADDYEOF

exec caddy run --config /tmp/Caddyfile --adapter caddyfile
