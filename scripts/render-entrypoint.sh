#!/bin/bash
set -euo pipefail

# =============================================================================
# Render free tier entrypoint — robust multi-service launcher
# =============================================================================
# Architecture:
#   :8080 → Caddy (reverse proxy)
#            ├── /vscode/* → code-server :9000
#            ├── /health    → 200 OK
#            └── /*         → OpenClaw :18789
#
# Robustness:
#   - Watchdog auto-restarts crashed child processes
#   - Startup validation before declaring ready
#   - Circuit breaker in Caddy for dead backends
#   - Config file over CLI flags (version-safe)
# =============================================================================

# ── Paths ──────────────────────────────────────────────────────────────────────
R2_BUCKET="${R2_BUCKET:-openclaw-backup}"
R2_PREFIX="${R2_PREFIX:-openclaw-state}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
CONFIG_FILE="${STATE_DIR}/openclaw.json"
CS_CONFIG_DIR="${HOME}/.config/code-server"
CS_CONFIG_FILE="${CS_CONFIG_DIR}/config.yaml"

# ── Log helper ─────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
error(){ echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2; }

# ── Ensure rclone ──────────────────────────────────────────────────────────────
if ! command -v rclone &>/dev/null; then
  log "rclone not found, installing..."
  curl -fsSL https://rclone.org/install.sh | bash
fi

rclone_configured() {
  [ -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" ] && [ -n "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:-}" ]
}

# ── Step 1: Restore state from R2 ──────────────────────────────────────────────
if rclone_configured; then
  log "Restoring OpenClaw state from R2..."
  if rclone lsd "r2:" 2>/dev/null | head -1 >/dev/null 2>&1 && \
     rclone ls "r2:${R2_BUCKET}/${R2_PREFIX}/latest/" 2>/dev/null | head -1 >/dev/null 2>&1; then
    mkdir -p "$STATE_DIR"
    rclone sync "r2:${R2_BUCKET}/${R2_PREFIX}/latest/" "$STATE_DIR/" \
      --exclude "node_modules/**" --exclude ".git/**"
    log "State restore complete."
  else
    log "No existing backup found. Starting fresh."
  fi
fi

# ── Step 2: OpenClaw config ────────────────────────────────────────────────────
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-render-$(openssl rand -hex 16)}"
export GATEWAY_TOKEN CONFIG_FILE STATE_DIR
mkdir -p "$STATE_DIR"

write_openclaw_config() {
  node -e "
    const fs = require('fs');
    const cfg = {
      gateway: {
        mode: 'remote',
        port: 18789,
        bind: 'lan',
        auth: { mode: 'token', token: process.env.GATEWAY_TOKEN },
        controlUi: {
          enabled: true,
          allowInsecureAuth: true,
          dangerouslyDisableDeviceAuth: true,
          allowedOrigins: ['https://openclaw-cg79.onrender.com']
        }
      }
    };
    fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  "
}

if [ ! -f "$CONFIG_FILE" ]; then
  log "Creating initial OpenClaw config..."
  write_openclaw_config
  log "Initial config created."
fi

# Re-patch on every start (ensures critical fields survive config changes)
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

# ── Step 3: Code-server config file (version-safe, survives flag changes) ───────
mkdir -p "$CS_CONFIG_DIR"
cat > "$CS_CONFIG_FILE" << YAMLEOF
bind-addr: 127.0.0.1:9000
auth: password
password: "${GATEWAY_TOKEN}"
user-data-dir: "${STATE_DIR}/.code-server"
abs-proxy-base-path: /vscode
disable-telemetry: true
YAMLEOF
log "code-server config written to ${CS_CONFIG_FILE}"

# ── Watchdog: process supervisor ──────────────────────────────────────────────
# Restarts a background process if it dies, up to max_retries times.
declare -A PID_MAP   # service_name -> pid
declare -A RETRY_MAP # service_name -> attempt count
MAX_RETRIES=5

start_service() {
  local name="$1"
  local cmd="$2"
  shift 2

  if [ ${RETRY_MAP[$name]:-0} -ge $MAX_RETRIES ]; then
    error "${name}: max retries (${MAX_RETRIES}) reached, not restarting"
    return 1
  fi

  RETRY_MAP[$name]=$((${RETRY_MAP[$name]:-0} + 1))
  log "${name}: starting (attempt ${RETRY_MAP[$name]}/${MAX_RETRIES})..."

  # Run in background; capture PID via $! immediately after &
  eval "$cmd" &
  local pid=$!
  PID_MAP[$name]=$pid

  log "${name}: PID ${pid}"
}

watchdog_loop() {
  while true; do
    for name in "${!PID_MAP[@]}"; do
      local pid=${PID_MAP[$name]}
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        : # alive
      elif [ -n "$pid" ]; then
        log "${name}: process ${pid} died unexpectedly"
        unset PID_MAP[$name]
        # Determine command to restart based on service name
        case "$name" in
          code-server)
            start_service "$name" "code-server --config ${CS_CONFIG_FILE}"
            ;;
          backup-loop)
            start_service "$name" "/app/scripts/r2-background-backup.sh"
            ;;
          openclaw)
            start_service "$name" "node /app/openclaw.mjs gateway --allow-unconfigured"
            ;;
        esac
      fi
    done
    sleep 5
  done
}

# ── Step 4: Start R2 backup loop ──────────────────────────────────────────────
if rclone_configured; then
  start_service "backup-loop" "/app/scripts/r2-background-backup.sh"
fi

# ── Step 5: Start OpenClaw gateway ────────────────────────────────────────────
start_service "openclaw" "node /app/openclaw.mjs gateway --allow-unconfigured"

# Wait until OpenClaw is listening
log "Waiting for OpenClaw gateway on port 18789..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    log "OpenClaw ready after ${i}s."
    break
  fi
  if [ "$i" -eq 30 ]; then
    error "OpenClaw did not start within 30s. Check logs."
  fi
  sleep 1
done

# ── Step 6: Start code-server ─────────────────────────────────────────────────
start_service "code-server" "code-server --config ${CS_CONFIG_FILE}"

# Wait until code-server is listening
log "Waiting for code-server on port 9000..."
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:9000/healthz >/dev/null 2>&1 || \
     curl -sf http://127.0.0.1:9000/ >/dev/null 2>&1; then
    log "code-server ready after ${i}s."
    break
  fi
  if [ "$i" -eq 15 ]; then
    log "code-server not responding yet — continuing anyway (watchdog will retry)"
  fi
  sleep 2
done

# ── Step 7: Start Watchdog (background) ───────────────────────────────────────
watchdog_loop &
WATCHDOG_PID=$!
log "Watchdog running (PID ${WATCHDOG_PID})"

# ── Step 8: Start Caddy reverse proxy (foreground) ────────────────────────────
log "Starting Caddy reverse proxy on port 8080..."

cat > /tmp/Caddyfile << 'CADDYEOF'
:8080 {
    # ── Health endpoints ──
    handle /health {
        header Content-Type "text/plain"
        respond "OK" 200
    }
    handle /healthz {
        header Content-Type "text/plain"
        respond "OK" 200
    }

    # ── code-server via /vscode/ ──
    handle /vscode/* {
        reverse_proxy localhost:9000 {
            # Passive health check — removes backend from pool after 5 failures
            health_uri /healthz
            health_interval 10s
            health_timeout 3s
            health_passes 1
            health_fails 5
            # WebSocket support for code-server terminal
            header_up Upgrade {http.request.header.Upgrade}
            header_up Connection {http.request.header.Connection}
        }
    }
    handle /vscode {
        redir /vscode/ 308
    }

    # ── Everything else → OpenClaw ──
    handle {
        reverse_proxy localhost:18789 {
            health_uri /healthz
            health_interval 10s
            health_timeout 3s
            health_passes 1
            health_fails 5
        }
    }
}
CADDYEOF

# Caddy runs in foreground as PID 1 (via tini)
exec caddy run --config /tmp/Caddyfile --adapter caddyfile
