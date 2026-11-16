#!/usr/bin/env bash
# ==============================================================================
# RocketScan for Seafile - Cross-Platform Linux & macOS Desktop Launcher
# ==============================================================================

set -e

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==================================================="
echo "  RocketScan for Seafile (Linux / macOS Launcher) "
echo "==================================================="
echo ""

# Verify Node.js is installed
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js (v18+) to run RocketScan."
    exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing required dependencies..."
    npm install
fi

# Headless / Server-only mode requested
if [ "$1" = "--server" ]; then
    echo "[INFO] Starting RocketScan Backend Server on http://localhost:3000..."
    npm start
    exit 0
fi

# Desktop mode if graphical display environment is detected and electron exists
HAS_DISPLAY=0
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || [ "$(uname)" = "Darwin" ]; then
    HAS_DISPLAY=1
fi

if [ "$HAS_DISPLAY" -eq 1 ] && [ -d "node_modules/electron" ]; then
    echo "[INFO] Launching RocketScan Desktop App..."
    npm run start:desktop
else
    echo "[INFO] Starting RocketScan Server on http://localhost:3000..."
    if command -v xdg-open >/dev/null 2>&1; then
        (sleep 2 && xdg-open "http://localhost:3000") >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        (sleep 2 && open "http://localhost:3000") >/dev/null 2>&1 &
    fi
    npm start
fi
