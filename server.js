const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const SeafileClient = require('./seafile-client');

const pkg = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

const CONFIG_FILE = process.env.CONFIG_PATH || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'config.json') : path.join(__dirname, 'config.json'));

const DEFAULT_PRESETS = [
  { id: 'notes', name: 'Notes', icon: '📁', repoId: 'c1b2b0d8-da24-439b-8513-efd16263073a', repoName: 'scannednote', folder: '/' },
  { id: 'work', name: 'Work', icon: '💼', repoId: 'c1b2b0d8-da24-439b-8513-efd16263073a', repoName: 'scannednote', folder: '/Work' },
  { id: 'receipts', name: 'Receipts', icon: '🧾', repoId: 'c1b2b0d8-da24-439b-8513-efd16263073a', repoName: 'scannednote', folder: '/Receipts' },
  { id: 'journal', name: 'Journal', icon: '📓', repoId: 'c1b2b0d8-da24-439b-8513-efd16263073a', repoName: 'scannednote', folder: '/Journal' }
];

// Helper: Semantic version comparison (1: v1 > v2, -1: v1 < v2, 0: v1 == v2)
function parseSemver(v) {
  if (!v) return [0, 0, 0];
  const cleaned = v.toString().replace(/^v/i, '').trim();
  const parts = cleaned.split('-')[0].split('.').map(p => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return 1;
    if (p1[i] < p2[i]) return -1;
  }
  return 0;
}

// Default initial config with persistent token caching
function loadConfig() {
  let cfg = {
    serverUrl: 'https://seafile.protutech.vip',
    token: '',
    repoId: 'c1b2b0d8-da24-439b-8513-efd16263073a',
    repoName: 'scannednote',
    folder: '/',
    autoUpload: true,
    filterDefault: 'magic',
    presets: DEFAULT_PRESETS
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!parsed.presets || !Array.isArray(parsed.presets) || parsed.presets.length === 0) {
        parsed.presets = DEFAULT_PRESETS;
      }
      cfg = { ...cfg, ...parsed };
    }
  } catch (err) {
    console.error('Error loading config.json:', err);
  }

  // Check persistent token cache if token is missing but serverUrl exists
  if (!cfg.token && cfg.serverUrl) {
    const cachedToken = SeafileClient.getCachedToken(cfg.serverUrl);
    if (cachedToken) {
      cfg.token = cachedToken;
      console.log(`[Config] Restored Seafile token from persistent token cache for ${cfg.serverUrl}`);
    }
  }

  return cfg;
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    if (cfg.serverUrl && cfg.token) {
      SeafileClient.setCachedToken(cfg.serverUrl, '', cfg.token, { repoId: cfg.repoId, repoName: cfg.repoName });
    }
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

// API: Generate QR Code for arbitrary URL / text (Direct Device Sharing)
app.get('/api/qrcode', async (req, res) => {
  try {
    const text = req.query.text;
    if (!text) {
      return res.status(400).json({ error: 'Query parameter "text" is required' });
    }
    const qrDataUrl = await QRCode.toDataURL(text, {
      margin: 1,
      width: 280,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.json({ qrCode: qrDataUrl, text });
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
    presets: appConfig.presets || DEFAULT_PRESETS,
    version: pkg.version
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

// -------------------------------------------------------------
// Seafile Connection, Health Check & Auto-Library Selection
// -------------------------------------------------------------

// API: Health check endpoint
app.get('/api/seafile/health', async (req, res) => {
  if (!appConfig.serverUrl) {
    return res.json({
      healthy: false,
      status: 'unconfigured',
      serverUrl: '',
      hasToken: false,
      message: 'Seafile server is not configured'
    });
  }

  try {
    const client = new SeafileClient(appConfig.serverUrl, appConfig.token);
    const health = await client.checkHealth();
    let libraryInfo = null;

    if (health.healthy && appConfig.token) {
      try {
        const repos = await client.listRepos();
        const activeRepo = repos.find(r => r.id === appConfig.repoId);
        libraryInfo = {
          totalLibraries: repos.length,
          activeRepoFound: Boolean(activeRepo),
          activeRepoName: activeRepo ? activeRepo.name : appConfig.repoName
        };
      } catch (e) {}
    }

    res.json({
      ...health,
      activeRepoId: appConfig.repoId,
      activeRepoName: appConfig.repoName,
      libraryInfo
    });
  } catch (err) {
    res.status(500).json({
      healthy: false,
      status: 'error',
      error: err.message
    });
  }
});

// API: Auto-select library endpoint
app.post('/api/seafile/auto-select-repo', async (req, res) => {
  try {
    const client = getSeafileClient();
    const selected = await client.selectBestLibrary();
    if (!selected) {
      return res.status(404).json({ error: 'No libraries available in this Seafile account' });
    }

    appConfig.repoId = selected.id;
    appConfig.repoName = selected.name;
    saveConfig(appConfig);

    res.json({
      success: true,
      repoId: selected.id,
      repoName: selected.name,
      selectedRepo: selected
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

    // Auto-select library if none configured
    if (!appConfig.repoId) {
      try {
        const autoRepo = await client.selectBestLibrary();
        if (autoRepo) {
          appConfig.repoId = autoRepo.id;
          appConfig.repoName = autoRepo.name;
        }
      } catch (e) {
        console.warn('Auto-library selection after login skipped:', e.message);
      }
    }

    saveConfig(appConfig);

    res.json({
      success: true,
      token,
      account: accountInfo,
      repoId: appConfig.repoId,
      repoName: appConfig.repoName
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Test token connection with auto-library detection
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

    // Cache valid token persistently
    SeafileClient.setCachedToken(serverUrl, account.email || '', token);

    // If appConfig doesn't have a valid repo, auto-select from loaded repos
    let suggestedRepo = null;
    if (!appConfig.repoId || !repos.some(r => r.id === appConfig.repoId)) {
      suggestedRepo = await client.selectBestLibrary();
      if (suggestedRepo && req.body.autoSaveRepo) {
        appConfig.repoId = suggestedRepo.id;
        appConfig.repoName = suggestedRepo.name;
        saveConfig(appConfig);
      }
    }

    res.json({
      success: true,
      account,
      librariesCount: repos.length,
      repos,
      suggestedRepo
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

// -------------------------------------------------------------
// Seafile Public Share Links (/api2/repos/:repo_id/file/shared-link/)
// -------------------------------------------------------------

// Explicit helper endpoint for frontend apps
app.post('/api/seafile/share-link', async (req, res) => {
  try {
    const repoId = req.body.repoId || appConfig.repoId;
    const filePath = req.body.path;

    if (!repoId || !filePath) {
      return res.status(400).json({ error: 'repoId and path are required' });
    }

    const client = getSeafileClient();
    const shareInfo = await client.createShareLink(repoId, filePath, {
      password: req.body.password,
      expire: req.body.expire
    });

    res.json({
      success: true,
      ...shareInfo
    });
  } catch (err) {
    console.error('Create share link error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Direct Seafile proxy endpoint matching Seafile API specification:
// PUT/GET/POST /api2/repos/:repo_id/file/shared-link/
app.all(['/api2/repos/:repo_id/file/shared-link/', '/api2/repos/:repo_id/file/shared-link', '/api/repos/:repo_id/file/shared-link/'], async (req, res) => {
  try {
    const repoId = req.params.repo_id || appConfig.repoId;
    const filePath = req.query.p || req.body.p || req.body.path;

    if (!repoId || !filePath) {
      return res.status(400).json({ error: 'repo_id and file path (p) are required' });
    }

    const client = getSeafileClient();
    const shareInfo = await client.createShareLink(repoId, filePath, {
      password: req.body.password,
      expire: req.body.expire
    });

    res.json({
      success: true,
      shared_link: shareInfo.shareUrl,
      link: shareInfo.shareUrl,
      token: shareInfo.token,
      repoId,
      path: filePath
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload scanned file to Seafile
app.post('/api/seafile/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const client = getSeafileClient();
    let repoId = req.body.repoId || appConfig.repoId;
    const folder = req.body.folder || appConfig.folder || '/RocketScan';
    const fileName = req.body.fileName || req.file.originalname || `Scan_${Date.now()}.pdf`;

    // Auto-select library if missing
    if (!repoId) {
      const autoRepo = await client.selectBestLibrary();
      if (autoRepo) {
        repoId = autoRepo.id;
        appConfig.repoId = autoRepo.id;
        appConfig.repoName = autoRepo.name;
        saveConfig(appConfig);
      } else {
        return res.status(400).json({ error: 'No target Seafile library (repoId) specified or found.' });
      }
    }

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

// -------------------------------------------------------------
// In-App & Server Auto-Updater (GitHub Releases & Commits)
// -------------------------------------------------------------

function getLocalCommitHash() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch (e) {
    return 'unknown';
  }
}

// API: Check for GitHub updates (both releases/tags and commits)
app.get('/api/updates/check', async (req, res) => {
  const currentVersion = pkg.version || '1.0.0';
  const repoOwner = 'IAndrexI';
  const repoName = 'notescanner';
  const releasesUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;
  const tagsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/tags`;
  const commitsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/main`;

  const localCommit = getLocalCommitHash();

  // Support simulated update for testing / verification
  if (req.query.simulate === 'true' || process.env.SIMULATE_UPDATE === 'true') {
    return res.json({
      hasUpdate: true,
      hasGitUpdate: true,
      localCommit,
      currentVersion,
      latestVersion: '1.2.0',
      latestCommit: {
        sha: 'a1b2c3d',
        message: 'Feature: Direct GitHub 1-click updates & enhanced handwriting OCR',
        date: new Date().toISOString()
      },
      releaseName: 'NoteScan v1.2.0 (GitHub 1-Click Update Release)',
      releaseNotes: '• Direct 1-click update from GitHub in app\n• Handwriting to digital font converter with drawing preservation\n• Direct APK in-app updater with 1-tap download\n• Seafile health check & exponential backoff',
      publishedAt: new Date().toISOString(),
      htmlUrl: `https://github.com/${repoOwner}/${repoName}`,
      apkUrl: '/api/updates/download-apk',
      apkDirectDownload: '/api/updates/download-apk'
    });
  }

  try {
    let latestCommit = null;
    let hasGitUpdate = false;

    // Check latest commit on main branch
    try {
      const commitRes = await fetch(commitsUrl, {
        headers: {
          'User-Agent': `NoteScan-App/${currentVersion}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (commitRes.ok) {
        const cData = await commitRes.json();
        const remoteShaShort = (cData.sha || '').slice(0, 7);
        if (localCommit !== 'unknown' && remoteShaShort && !localCommit.startsWith(remoteShaShort) && !remoteShaShort.startsWith(localCommit)) {
          hasGitUpdate = true;
        }
        latestCommit = {
          sha: remoteShaShort,
          message: cData.commit?.message?.split('\n')[0] || '',
          date: cData.commit?.author?.date || null,
          author: cData.commit?.author?.name || ''
        };
      }
    } catch (commitErr) {
      console.warn('[Updater] Could not fetch GitHub commits:', commitErr.message);
    }

    const ghRes = await fetch(releasesUrl, {
      headers: {
        'User-Agent': `NoteScan-App/${currentVersion}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (ghRes.ok) {
      const release = await ghRes.json();
      const latestTag = release.tag_name || release.name || '';
      const latestVersion = latestTag.replace(/^v/i, '').trim();

      const hasSemverUpdate = compareSemver(latestVersion, currentVersion) > 0;
      const hasUpdate = hasSemverUpdate || hasGitUpdate;

      // Locate APK asset in release if available
      let apkAsset = null;
      if (Array.isArray(release.assets)) {
        apkAsset = release.assets.find(a => a.name.toLowerCase().endsWith('.apk'));
      }

      return res.json({
        hasUpdate,
        hasGitUpdate,
        localCommit,
        latestCommit,
        currentVersion,
        latestVersion,
        releaseName: release.name || latestTag,
        releaseNotes: release.body || '',
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        apkUrl: apkAsset ? apkAsset.browser_download_url : '/api/updates/download-apk',
        apkDirectDownload: '/api/updates/download-apk'
      });
    }

    // Fallback: Check tags if releases/latest is 404
    if (ghRes.status === 404) {
      const tagsRes = await fetch(tagsUrl, {
        headers: {
          'User-Agent': `NoteScan-App/${currentVersion}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (tagsRes.ok) {
        const tags = await tagsRes.json();
        if (Array.isArray(tags) && tags.length > 0) {
          const topTag = tags[0].name.replace(/^v/i, '').trim();
          const hasSemverUpdate = compareSemver(topTag, currentVersion) > 0;
          const hasUpdate = hasSemverUpdate || hasGitUpdate;

          return res.json({
            hasUpdate,
            hasGitUpdate,
            localCommit,
            latestCommit,
            currentVersion,
            latestVersion: topTag,
            releaseName: `NoteScan v${topTag}`,
            releaseNotes: 'New version available on GitHub.',
            publishedAt: null,
            htmlUrl: `https://github.com/${repoOwner}/${repoName}`,
            apkUrl: '/api/updates/download-apk',
            apkDirectDownload: '/api/updates/download-apk'
          });
        }
      }
    }

    // Default: Up to date or check commit status
    res.json({
      hasUpdate: hasGitUpdate,
      hasGitUpdate,
      localCommit,
      latestCommit,
      currentVersion,
      latestVersion: currentVersion,
      htmlUrl: `https://github.com/${repoOwner}/${repoName}`,
      apkUrl: '/api/updates/download-apk',
      apkDirectDownload: '/api/updates/download-apk',
      message: hasGitUpdate ? 'New commit available on GitHub.' : 'NoteScan is up to date.'
    });
  } catch (err) {
    console.warn('[Updater] Failed to check GitHub updates:', err.message);
    res.json({
      hasUpdate: false,
      hasGitUpdate: false,
      localCommit,
      currentVersion,
      latestVersion: currentVersion,
      error: `Could not check updates: ${err.message}`
    });
  }
});

// API: 1-Click Server Update directly from GitHub
app.post('/api/updates/apply', (req, res) => {
  const { exec } = require('child_process');
  const isGitRepo = fs.existsSync(path.join(__dirname, '.git'));

  if (!isGitRepo) {
    return res.status(400).json({
      error: 'This installation is not a Git clone. To enable 1-click updates, clone the project via git.'
    });
  }

  console.log('[Updater] Pulling latest updates from GitHub (main)...');
  const updateCmd = 'git fetch origin main && git reset --hard origin/main && npm install --omit=dev';

  exec(updateCmd, { cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
      console.error('[Updater] Git update error:', error, stderr);
      return res.status(500).json({ error: `Update failed: ${stderr || error.message}` });
    }

    const newCommit = getLocalCommitHash();
    console.log(`[Updater] Updated to commit ${newCommit}`);

    res.json({
      success: true,
      message: `Successfully updated to commit ${newCommit}! Server restarting in 2 seconds...`,
      newCommit,
      output: stdout
    });

    // Gracefully restart the service or process after sending response
    setTimeout(() => {
      // 1. Try Alpine OpenRC service
      exec('which rc-service && rc-service notescan restart', (err1) => {
        if (!err1) return;
        // 2. Try Debian/Ubuntu systemd service
        exec('which systemctl && systemctl restart notescan', (err2) => {
          if (!err2) return;
          // 3. Fallback: Exit process (Docker or supervisor will auto-restart)
          process.exit(0);
        });
      });
    }, 2000);
  });
});

// API: 1-Tap direct download of NoteScan.apk
app.get('/api/updates/download-apk', (req, res) => {
  const localApkPath = path.join(__dirname, 'NoteScan.apk');
  if (fs.existsSync(localApkPath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="NoteScan.apk"');
    const stream = fs.createReadStream(localApkPath);
    return stream.pipe(res);
  }

  // If local APK is not found, redirect to GitHub raw direct download
  res.redirect(`https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk`);
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

// -------------------------------------------------------------
// OCR & Handwriting Recognition Engine (Tesseract.js)
// -------------------------------------------------------------
let ocrWorker = null;
async function getOcrWorker() {
  if (!ocrWorker) {
    const { createWorker } = require('tesseract.js');
    ocrWorker = await createWorker('eng');
  }
  return ocrWorker;
}

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    let imageBuffer = null;
    let region = null;

    if (req.file && req.file.buffer) {
      imageBuffer = req.file.buffer;
    } else if (req.body.image) {
      const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    }

    if (req.body.region) {
      try {
        region = typeof req.body.region === 'string' ? JSON.parse(req.body.region) : req.body.region;
      } catch (e) {}
    }

    if (!imageBuffer) {
      return res.status(400).json({ error: 'No image provided for OCR.' });
    }

    const worker = await getOcrWorker();
    const options = {};
    if (region && Number(region.width) > 0 && Number(region.height) > 0) {
      options.rectangle = {
        left: Math.max(0, Math.round(Number(region.x || region.left || 0))),
        top: Math.max(0, Math.round(Number(region.y || region.top || 0))),
        width: Math.round(Number(region.width)),
        height: Math.round(Number(region.height))
      };
    }

    const result = await worker.recognize(imageBuffer, options);
    const data = result.data || {};

    // Extract structured lines with bounding boxes and normalized coordinates
    const lines = (data.lines || []).map(line => {
      const bbox = line.bbox || {};
      const x0 = Number(bbox.x0 ?? bbox.left ?? 0);
      const y0 = Number(bbox.y0 ?? bbox.top ?? 0);
      const x1 = Number(bbox.x1 ?? (x0 + (bbox.width || 0)));
      const y1 = Number(bbox.y1 ?? (y0 + (bbox.height || 0)));
      const width = x1 - x0;
      const height = y1 - y0;

      return {
        text: (line.text || '').trim(),
        confidence: line.confidence || 0,
        bbox: { x0, y0, x1, y1, width, height },
        words: (line.words || []).map(w => ({
          text: (w.text || '').trim(),
          confidence: w.confidence || 0,
          bbox: {
            x0: w.bbox?.x0 || 0,
            y0: w.bbox?.y0 || 0,
            x1: w.bbox?.x1 || 0,
            y1: w.bbox?.y1 || 0,
            width: (w.bbox?.x1 || 0) - (w.bbox?.x0 || 0),
            height: (w.bbox?.y1 || 0) - (w.bbox?.y0 || 0)
          }
        }))
      };
    }).filter(l => l.text.length > 0);

    res.json({
      success: true,
      text: data.text || '',
      confidence: data.confidence || 0,
      lines,
      region: options.rectangle || null
    });
  } catch (err) {
    console.error('OCR recognition error:', err);
    res.status(500).json({ error: 'OCR processing failed: ' + err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`=======================================================`);
  console.log(`  RocketScan for Seafile is active!`);
  console.log(`  Version:               v${pkg.version}`);
  console.log(`  PC Desktop Interface:  http://localhost:${PORT}`);
  console.log(`  Android Phone Link:    http://${localIp}:${PORT}`);
  console.log(`=======================================================`);
});
