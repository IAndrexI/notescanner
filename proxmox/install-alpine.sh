#!/bin/sh
# Proxmox Ultra-Lightweight Alpine Linux Installer for NoteScan
set -e

echo "=========================================================="
echo "  NoteScan Alpine Linux 1-Click Installer"
echo "  Target: ~20MB RAM idle & <100MB Total Disk Usage"
echo "=========================================================="

# 1. Update and install minimal packages
echo "[1/4] Installing Node.js & Git on Alpine..."
apk update
apk add --no-cache nodejs npm git curl

INSTALL_DIR="/opt/notescan"
echo "[2/4] Setting up NoteScan in ${INSTALL_DIR}..."
if [ ! -d "${INSTALL_DIR}" ]; then
    mkdir -p "${INSTALL_DIR}"
    git clone https://github.com/IAndrexI/notescanner.git "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

# 2. Production dependencies
echo "[3/4] Installing lightweight production dependencies..."
npm ci --omit=dev || npm install --omit=dev

# 3. OpenRC service setup
echo "[4/4] Setting up OpenRC service..."
INITD_FILE="${INSTALL_DIR}/proxmox/notescan.initd"
if [ ! -f "${INITD_FILE}" ]; then
    INITD_FILE="${INSTALL_DIR}/proxmox/notescanner.initd"
fi
cp "${INITD_FILE}" /etc/init.d/notescan
chmod +x /etc/init.d/notescan
rc-update add notescan default
rc-service notesan restart 2>/dev/null || rc-service notescan restart

IP_ADDR=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -i)
echo "=========================================================="
echo "  ✓ NoteScan is running on Alpine Linux!"
echo "  Access URL: http://${IP_ADDR}:3000"
echo "  Service commands:"
echo "    rc-service notescan status"
echo "    rc-service notescan restart"
echo "    tail -f /var/log/notescan.log"
echo "=========================================================="
