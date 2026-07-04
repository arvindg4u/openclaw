#!/bin/bash
set -euo pipefail

# Background backup loop - runs alongside OpenClaw gateway
# Periodically syncs OpenClaw state to R2

R2_BUCKET="${R2_BUCKET:-openclaw-backup}"
R2_PREFIX="${R2_PREFIX:-openclaw-state}"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-3600}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"

log() {
  echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

# Wait for gateway to be ready before first backup
sleep 30

while true; do
  if [ -d "$STATE_DIR" ] && [ -n "$(ls -A "$STATE_DIR" 2>/dev/null)" ]; then
    log "Starting backup to R2..."
    if rclone sync "$STATE_DIR/" "r2:${R2_BUCKET}/${R2_PREFIX}/latest/" \
      --progress \
      --exclude "node_modules/**" \
      --exclude ".git/**" \
      --exclude "*.log" \
      --exclude ".cache/**" 2>&1; then
      log "Backup complete."
    else
      log "Backup failed (will retry)."
    fi
  else
    log "State directory empty or missing. Skipping backup."
  fi
  sleep "$BACKUP_INTERVAL"
done
