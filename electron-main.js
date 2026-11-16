const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;

// Ensure single instance across Windows and Linux
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Check if RocketScan HTTP backend is already responding
function isServerListening(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Poll until HTTP server is reachable
async function waitForServer(url, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await isServerListening(url)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Start backend Express server if not already running
function launchServerProcess() {
  const serverPath = path.join(__dirname, 'server.js');
  console.log(`[RocketScan Desktop] Starting backend server (${serverPath})...`);

  serverProcess = fork(serverPath, [], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('[RocketScan Desktop] Server process failed to start:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[RocketScan Desktop] Server process exited (code=${code}, signal=${signal})`);
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      console.warn('[RocketScan Desktop] Server terminated unexpectedly.');
    }
  });
}

function stopServerProcess() {
  isQuitting = true;
  if (serverProcess) {
    console.log('[RocketScan Desktop] Terminating backend server...');
    try {
      if (process.platform === 'win32') {
        serverProcess.kill();
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (err) {
      console.error('[RocketScan Desktop] Error terminating server:', err);
    }
    serverProcess = null;
  }
}

async function createMainWindow() {
  const alreadyRunning = await isServerListening(SERVER_URL);
  if (!alreadyRunning) {
    launchServerProcess();
    const ready = await waitForServer(SERVER_URL);
    if (!ready) {
      console.error(`[RocketScan Desktop] Backend server did not respond at ${SERVER_URL} within timeout.`);
    }
  } else {
    console.log(`[RocketScan Desktop] Backend server is already running at ${SERVER_URL}`);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: 'RocketScan for Seafile',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Load the web app seamlessly
  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links (e.g. Seafile cloud downloads, external web links) in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServerProcess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServerProcess();
});

process.on('SIGINT', () => {
  stopServerProcess();
  app.quit();
});

process.on('SIGTERM', () => {
  stopServerProcess();
  app.quit();
});
