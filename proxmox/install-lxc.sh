#!/usr/bin/env bash
# Proxmox LXC 1-Click Installer for NoteScan (Debian/Ubuntu)
set -euo pipefail

echo "======================================================"
echo "  NoteScan Proxmox LXC Installer"
echo "======================================================"

if ! command -v node >/dev/null 2>&1; then
    echo "[1/4] Installing Node.js LTS..."
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg git
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
else
    echo "[1/4] Node.js is already installed ($(node -v))"
fi

INSTALL_DIR="/opt/notescan"
echo "[2/4] Setting up NoteScan in ${INSTALL_DIR}..."

if [ ! -d "${INSTALL_DIR}" ]; then
    mkdir -p "${INSTALL_DIR}"
    git clone https://github.com/IAndrexI/notescanner.git "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
echo "[3/4] Installing production dependencies..."
npm ci --omit=dev || npm install --omit=dev

echo "[4/4] Configuring and starting systemd service..."
SERVICE_FILE="${INSTALL_DIR}/proxmox/notescan.service"
if [ ! -f "${SERVICE_FILE}" ]; then
    SERVICE_FILE="${INSTALL_DIR}/proxmox/notescanner.service"
fi
cp "${SERVICE_FILE}" /etc/systemd/system/notescan.service
systemctl daemon-reload
systemctl enable notescan
systemctl restart notescan

IP_ADDR=$(hostname -I | awk '{print $1}')
echo "======================================================"
echo "  NoteScan is now running on Proxmox!"
echo "  Access URL: http://${IP_ADDR}:3000"
echo "  Service status: systemctl status notescan"
echo "======================================================"
