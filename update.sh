#!/bin/sh
# NoteScan 1-Click Updater for Proxmox, Alpine, and Linux
set -e

echo "=========================================================="
echo "  NoteScan 1-Click Updater (Pull from GitHub)"
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/3] Fetching latest changes from GitHub (main)..."
git fetch origin main
git reset --hard origin/main

echo "[2/3] Updating production dependencies..."
npm install --omit=dev

echo "[3/3] Restarting NoteScan service..."
if command -v rc-service >/dev/null 2>&1 && rc-service notescan status >/dev/null 2>&1; then
    rc-service notescan restart
    echo "✓ OpenRC service restarted successfully."
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet notescan 2>/dev/null; then
    systemctl restart notescan
    echo "✓ Systemd service restarted successfully."
else
    echo "Note: If running in Docker or standalone, please restart container/process."
fi

COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
echo "=========================================================="
echo "  ✓ NoteScan successfully updated to commit ${COMMIT}!"
echo "=========================================================="
