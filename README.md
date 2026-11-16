# NoteScanner 🚀

A high-performance document scanner inspired by **Rocketbook**, built for **Android, Windows, Linux, and Proxmox VE servers** with instant 1-tap backup to your **Seafile Cloud Server**.

---

## ✨ Features

- **Rocketbook-style Computer Vision:**
  - **Automatic Edge Detection**: Real-time corner detection for pages, documents, whiteboards, and notebooks.
  - **4-Corner Perspective Warp**: Interactive corner handles with precision touch loupe to flatten angled camera shots into aligned rectangular documents.
  - **Rocketbook "Magic Ink" Filter**: Strips desk lighting and hand shadows, whitens page backgrounds, and punches up dark handwritten ink while retaining highlighter colors.
  - **B&W & Grayscale Filters**: Adaptive binarization for clean printer-ready documents.
- **1-Tap Quick-Send to Seafile (Rocketbook Destination Icons):**
  - Instant destination buttons right on the review screen (`📁 Notes`, `💼 Work`, `🧾 Receipts`, `📓 Journal`).
  - Tapping a button automatically compiles the multi-page PDF and uploads to that exact Seafile library and subfolder in **one tap**.
  - **Auto-Send Toggle**: Automatically upload to Seafile in the background as soon as you confirm a scan.
  - Toast notification with direct **`[👁️ View in Seafile]`** link.
- **Multi-Device & Multiplatform:**
  - **Proxmox Server**: Run 24/7 in a Docker container or ultra-lightweight LXC container.
  - **Android**: Installable as a full-screen PWA ("Add to Home Screen") with native camera autofocus and flash/torch control.
  - **Windows & Linux**: Run as a native desktop application via Electron, or access via web browser.
  - **Local Seafile Client Auto-Sync**: Detects local Seafile folders on both Windows and Linux.

---

## 🖥️ Running on a Proxmox VE Server

### Method A: Ultra-Lightweight Alpine Linux LXC (Recommended ⭐)
* **RAM footprint:** ~20 MB - 30 MB idle
* **Disk footprint:** < 100 MB total
* **Boot time:** < 1 second

1. In Proxmox GUI, go to your storage -> **CT Templates** -> **Templates** -> download **`alpine-3.21`** (or 3.20).
2. Click **Create CT**:
   * **Template:** Alpine Linux
   * **Disks:** 2 GB is plenty
   * **CPU:** 1 Core
   * **Memory:** 256 MB
3. Start the container, open its **Console**, and run:

```sh
apk add --no-cache git
git clone https://github.com/IAndrexI/notescanner.git /tmp/notescanner
chmod +x /tmp/notescanner/proxmox/install-alpine.sh
/tmp/notescanner/proxmox/install-alpine.sh
```

---

### Method B: Docker Compose
If you already have a Docker LXC or VM running in Proxmox:

```bash
git clone https://github.com/IAndrexI/notescanner.git
cd notescanner
docker compose up -d
```
Your server will be running at `http://<proxmox-ip>:3000` with persistent configuration saved in `./data`.

---

### Method C: Debian / Ubuntu LXC Container
Inside a standard Debian 12 or Ubuntu 24.04 LXC container:

```bash
git clone https://github.com/IAndrexI/notescanner.git /tmp/notescanner
cd /tmp/notescanner/proxmox
chmod +x install-lxc.sh
./install-lxc.sh
```

---

## 💻 Running Locally (Windows & Linux)

### Windows
Double-click `start.bat` or run:
```cmd
npm install
npm run start:desktop  # Native desktop app
# OR
npm start              # Headless server
```

### Linux
```bash
chmod +x start.sh
./start.sh            # Launches desktop app if DISPLAY is present
./start.sh --server   # Headless server
```

---

## 📱 Connecting Your Android Phone

1. On your PC or Proxmox web interface (`http://<ip>:3000`), navigate to **PC Notes**.
2. Point your Android phone camera at the on-screen QR code (or browse to the displayed local link).
3. Tap Chrome's menu (three dots) -> **"Add to Home screen"** or **"Install App"**.
4. Point your phone camera at your notebook pages, pick a destination pill (`📁 Notes`, `💼 Work`, etc.), and watch it instantly sync into your Seafile cloud and PC!
