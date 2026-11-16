#!/bin/sh
# Proxmox Ultra-Lightweight Alpine Linux Installer for NoteScanner
set -e

echo "=========================================================="
echo "  NoteScanner Alpine Linux 1-Click Installer"
echo "  Target: ~20MB RAM idle & <100MB Total Disk Usage"
echo "=========================================================="

# 1. Update and install minimal packages
echo "[1/4] Installing Node.js & Git on Alpine..."
apk update
apk add --no-cache nodejs npm git curl

INSTALL_DIR="/opt/notescanner"
echo "[2/4] Setting up NoteScanner in ${INSTALL_DIR}..."
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
cp "${INSTALL_DIR}/proxmox/notescanner.initd" /etc/init.d/notescanner
chmod +x /etc/init.d/notescanner
rc-update add notescanner default
rc-service notescanner restart

IP_ADDR=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -i)
echo "=========================================================="
echo "  ✓ NoteScanner is running on Alpine Linux!"
echo "  Access URL: http://${IP_ADDR}:3000"
echo "  Service commands:"
echo "    rc-service notescanner status"
echo "    rc-service notescanner restart"
echo "    tail -f /var/log/notescanner.log"
echo "=========================================================="
