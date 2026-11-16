#!/usr/bin/env bash
# Proxmox LXC 1-Click Installer for NoteScanner (Debian/Ubuntu)
set -euo pipefail

echo "======================================================"
echo "  NoteScanner Proxmox LXC Installer"
echo "======================================================"

# Update and install Node.js 22 LTS if not present
if ! command -v node >/dev/null 2>&1; then
    echo "[1/4] Installing Node.js LTS..."
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg git
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
else
    echo "[1/4] Node.js is already installed ($(node -v))"
fi

INSTALL_DIR="/opt/notescanner"
echo "[2/4] Setting up NoteScanner in ${INSTALL_DIR}..."

if [ ! -d "${INSTALL_DIR}" ]; then
    mkdir -p "${INSTALL_DIR}"
    cp -r "$(pwd)"/* "${INSTALL_DIR}/" || git clone https://github.com/IAndrexI/notescanner.git "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
echo "[3/4] Installing production dependencies..."
npm ci --omit=dev || npm install --omit=dev

echo "[4/4] Configuring and starting systemd service..."
cp "${INSTALL_DIR}/proxmox/notescanner.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable notescanner
systemctl restart notescanner

IP_ADDR=$(hostname -I | awk '{print $1}')
echo "======================================================"
echo "  NoteScanner is now running on Proxmox!"
echo "  Access URL: http://${IP_ADDR}:3000"
echo "  Service status: systemctl status notescanner"
echo "======================================================"
