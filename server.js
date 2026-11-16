const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const SeafileClient = require('./seafile-client');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

const CONFIG_FILE = process.env.CONFIG_PATH || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'config.json') : path.join(__dirname, 'config.json'));

const DEFAULT_PRESETS = [
  { id: 'notes', name: 'Notes', icon: '📁', repoId: '', repoName: '', folder: '/RocketScan/Notes' },
  { id: 'work', name: 'Work', icon: '💼', repoId: '', repoName: '', folder: '/RocketScan/Work' },
  { id: 'receipts', name: 'Receipts', icon: '🧾', repoId: '', repoName: '', folder: '/RocketScan/Receipts' },
  { id: 'journal', name: 'Journal', icon: '📓', repoId: '', repoName: '', folder: '/RocketScan/Journal' }
];

// Default initial config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!parsed.presets || !Array.isArray(parsed.presets) || parsed.presets.length === 0) {
        parsed.presets = DEFAULT_PRESETS;
      }
      return parsed;
    }
  } catch (err) {
    console.error('Error loading config.json:', err);
  }
  return {
    serverUrl: '',
    token: '',
    repoId: '',
    repoName: '',
    folder: '/RocketScan',
    autoUpload: true,
    filterDefault: 'magic',
    presets: DEFAULT_PRESETS
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config.json:', err);
  }
}

let appConfig = loadConfig();

function getSeafileClient(customConfig = null) {
  const cfg = customConfig || appConfig;
  if (!cfg.serverUrl || !cfg.token) {
    throw new Error('Seafile server URL and API token are not configured.');
  }
  return new SeafileClient(cfg.serverUrl, cfg.token);
}

// Get non-internal IPv4 address for local network display
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API: Get Network and Connection info
app.get('/api/network-info', async (req, res) => {
  try {
    const ip = getLocalIp();
    const url = `http://${ip}:${PORT}`;
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    res.json({
      localIp: ip,
      port: PORT,
      connectUrl: url,
      qrCode: qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Config endpoints
app.get('/api/config', (req, res) => {
  res.json({
    serverUrl: appConfig.serverUrl,
    hasToken: Boolean(appConfig.token),
    repoId: appConfig.repoId,
    repoName: appConfig.repoName,
    folder: appConfig.folder,
    autoUpload: appConfig.autoUpload !== undefined ? appConfig.autoUpload : true,
    filterDefault: appConfig.filterDefault || 'magic',
    presets: appConfig.presets || DEFAULT_PRESETS
  });
});

app.post('/api/config', (req, res) => {
  const { serverUrl, token, repoId, repoName, folder, autoUpload, filterDefault, presets } = req.body;
  if (serverUrl !== undefined) appConfig.serverUrl = serverUrl.trim();
  if (token !== undefined && token.trim() !== '') appConfig.token = token.trim();
  if (repoId !== undefined) appConfig.repoId = repoId;
  if (repoName !== undefined) appConfig.repoName = repoName;
  if (folder !== undefined) appConfig.folder = folder;
  if (autoUpload !== undefined) appConfig.autoUpload = Boolean(autoUpload);
  if (filterDefault !== undefined) appConfig.filterDefault = filterDefault;
  if (presets !== undefined && Array.isArray(presets)) appConfig.presets = presets;

  saveConfig(appConfig);
  res.json({ success: true, config: appConfig });
});

// API: Authenticate with username and password
app.post('/api/seafile/login', async (req, res) => {
  try {
    const { serverUrl, username, password } = req.body;
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ error: 'serverUrl, username, and password are required.' });
    }

    const token = await SeafileClient.authenticate(serverUrl, username, password);
    const client = new SeafileClient(serverUrl, token);
    const accountInfo = await client.getAccountInfo();

    appConfig.serverUrl = serverUrl.trim();
    appConfig.token = token;
    saveConfig(appConfig);

    res.json({
      success: true,
      token,
      account: accountInfo
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Test token connection
app.post('/api/seafile/test', async (req, res) => {
  try {
    const serverUrl = req.body.serverUrl || appConfig.serverUrl;
    const token = req.body.token || appConfig.token;
    if (!serverUrl || !token) {
      return res.status(400).json({ error: 'Server URL and Token are required' });
    }

    const client = new SeafileClient(serverUrl, token);
    const account = await client.getAccountInfo();
    const repos = await client.listRepos();

    res.json({
      success: true,
      account,
      librariesCount: repos.length,
      repos
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: List repos / libraries
app.get('/api/seafile/repos', async (req, res) => {
  try {
    const client = getSeafileClient();
    const repos = await client.listRepos();
    res.json(repos);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Upload scanned file to Seafile
app.post('/api/seafile/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const repoId = req.body.repoId || appConfig.repoId;
    const folder = req.body.folder || appConfig.folder || '/RocketScan';
    const fileName = req.body.fileName || req.file.originalname || `Scan_${Date.now()}.pdf`;

    if (!repoId) {
      return res.status(400).json({ error: 'No target Seafile library (repoId) specified.' });
    }

    const client = getSeafileClient();

    // Ensure folder exists
    const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
    if (cleanFolder) {
      const parts = cleanFolder.split('/');
      let curr = '/';
      for (const p of parts) {
        await client.ensureDir(repoId, curr, p);
        curr = `${curr}${p}/`;
      }
    }

    const result = await client.uploadFile(
      repoId,
      folder,
      fileName,
      req.file.buffer,
      req.file.mimetype || 'application/pdf'
    );

    const cleanFolderForUrl = folder.replace(/^\/+|\/+$/g, '');
    const cleanPath = cleanFolderForUrl ? `${cleanFolderForUrl}/${fileName}` : fileName;
    const viewUrl = appConfig.serverUrl 
      ? `${appConfig.serverUrl.replace(/\/+$/, '')}/#common/lib/${repoId}/${encodeURIComponent(cleanPath)}`
      : '';

    res.json({
      success: true,
      message: 'Uploaded to Seafile successfully',
      result,
      repoId,
      folder,
      fileName,
      filePath: `/${cleanPath}`,
      viewUrl
    });
  } catch (err) {
    console.error('Seafile upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: List scanned files in Seafile folder (for PC desktop gallery)
app.get('/api/seafile/files', async (req, res) => {
  try {
    const repoId = req.query.repoId || appConfig.repoId;
    const folder = req.query.folder || appConfig.folder || '/RocketScan';

    if (!repoId) {
      return res.json({ files: [], warning: 'No library selected in settings.' });
    }

    const client = getSeafileClient();
    const items = await client.listFiles(repoId, folder);
    
    // Filter to documents/images and sort newest first
    const files = items
      .filter(item => item.type === 'file')
      .map(item => ({
        name: item.name,
        size: item.size,
        mtime: item.mtime,
        isPdf: item.name.toLowerCase().endsWith('.pdf'),
        isImage: /\.(jpe?g|png|webp)$/i.test(item.name),
        fullPath: `${folder.replace(/\/+$/, '')}/${item.name}`
      }))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    res.json({ files, folder, repoId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Get download / preview link for a file in Seafile
app.get('/api/seafile/file-url', async (req, res) => {
  try {
    const repoId = req.query.repoId || appConfig.repoId;
    const filePath = req.query.path;

    if (!repoId || !filePath) {
      return res.status(400).json({ error: 'repoId and path are required' });
    }

    const client = getSeafileClient();
    const downloadUrl = await client.getFileDownloadLink(repoId, filePath);
    res.json({ url: downloadUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Check if local Seafile desktop client directory exists on PC (Windows, Linux, macOS)
app.get('/api/local-seafile', (req, res) => {
  const homeDir = os.homedir();
  let username = '';
  try {
    username = os.userInfo().username || '';
  } catch (e) {
    username = process.env.USER || process.env.USERNAME || '';
  }

  const potentialPaths = [
    // Standard User Home paths (Windows, Linux, macOS)
    path.join(homeDir, 'Seafile'),
    path.join(homeDir, 'Seafile', 'My Library'),
    path.join(homeDir, 'SeafileDrive'),
    path.join(homeDir, '.seafile-data'),
    path.join(homeDir, '.ccnet'),

    // Windows paths (Virtual drive or standard drive mapping)
    'S:\\',
    'S:/',

    // Linux default paths
    '/var/lib/seafile',
    '/opt/seafile',
    '/media/Seafile'
  ];

  if (username) {
    potentialPaths.push(path.join('/media', username, 'Seafile'));
    potentialPaths.push(path.join('/run/media', username, 'Seafile'));
  }

  // Scan Linux /media, /run/media, and /mnt for mounted Seafile libraries / drives
  const mountBases = ['/media', '/run/media', '/mnt'];
  for (const base of mountBases) {
    try {
      if (fs.existsSync(base)) {
        const topDirs = fs.readdirSync(base, { withFileTypes: true });
        for (const top of topDirs) {
          if (!top.isDirectory()) continue;
          const topPath = path.join(base, top.name);
          if (top.name.toLowerCase().includes('seafile')) {
            potentialPaths.push(topPath);
          }
          const directSeafile = path.join(topPath, 'Seafile');
          if (fs.existsSync(directSeafile)) {
            potentialPaths.push(directSeafile);
          }

          // Check subdirectories (e.g. /media/$USER/external-drive/Seafile)
          try {
            const subDirs = fs.readdirSync(topPath, { withFileTypes: true });
            for (const sub of subDirs) {
              if (!sub.isDirectory()) continue;
              if (sub.name.toLowerCase().includes('seafile')) {
                potentialPaths.push(path.join(topPath, sub.name));
              }
              const subSeafile = path.join(topPath, sub.name, 'Seafile');
              if (fs.existsSync(subSeafile)) {
                potentialPaths.push(subSeafile);
              }
            }
          } catch (e) {
            // Ignore permission errors on subdirectories
          }
        }
      }
    } catch (e) {
      // Ignore filesystem permission errors
    }
  }

  // Deduplicate and filter existing paths
  const uniquePaths = Array.from(new Set(potentialPaths));
  const found = uniquePaths.filter(p => {
    try {
      return fs.existsSync(p);
    } catch (e) {
      return false;
    }
  });

  res.json({
    hasLocalSeafile: found.length > 0,
    foundPaths: found,
    platform: process.platform
  });
});

app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`=======================================================`);
  console.log(`  RocketScan for Seafile is active!`);
  console.log(`  PC Desktop Interface:  http://localhost:${PORT}`);
  console.log(`  Android Phone Link:    http://${localIp}:${PORT}`);
  console.log(`=======================================================`);
});
