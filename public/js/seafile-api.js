/**
 * SeafileApi: Bridge between frontend UI and Seafile Backend Proxy
 */
class SeafileApi {
  static getBaseUrl() {
    const customServer = localStorage.getItem('notescan_backend_url');
    if (customServer) {
      return customServer.replace(/\/+$/, '');
    }
    // If running in Capacitor or native wrapper where origin is capacitor:// or file://
    if (window.location.origin.startsWith('capacitor:') || window.location.origin.startsWith('file:') || window.location.origin === 'null') {
      return localStorage.getItem('notescan_backend_url') || '';
    }
    return '';
  }

  static setBaseUrl(url) {
    if (url) {
      localStorage.setItem('notescan_backend_url', url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem('notescan_backend_url');
    }
  }

  static apiUrl(path) {
    const base = SeafileApi.getBaseUrl();
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  static async getNetworkInfo() {
    const res = await fetch(SeafileApi.apiUrl('/api/network-info'));
    if (!res.ok) throw new Error('Failed to load network info');
    return await res.json();
  }

  static async getConfig() {
    const res = await fetch(SeafileApi.apiUrl('/api/config'));
    if (!res.ok) throw new Error('Failed to load config');
    return await res.json();
  }

  static async saveConfig(cfg) {
    const res = await fetch(SeafileApi.apiUrl('/api/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    if (!res.ok) throw new Error('Failed to save config');
    return await res.json();
  }

  static async login(serverUrl, username, password) {
    const res = await fetch(SeafileApi.apiUrl('/api/seafile/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  }

  static async testConnection(serverUrl, token) {
    const res = await fetch(SeafileApi.apiUrl('/api/seafile/test'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, token, autoSaveRepo: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection failed');
    return data;
  }

  // Health check
  static async checkHealth() {
    try {
      const res = await fetch(SeafileApi.apiUrl('/api/seafile/health'));
      return await res.json();
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  // Auto-library selection
  static async autoSelectRepo() {
    const res = await fetch(SeafileApi.apiUrl('/api/seafile/auto-select-repo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to auto-select library');
    return data;
  }

  static async getRepos() {
    const res = await fetch(SeafileApi.apiUrl('/api/seafile/repos'));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to list libraries');
    return data;
  }

  static async uploadFile(fileBlob, fileName, repoId, folder) {
    const formData = new FormData();
    formData.append('file', fileBlob, fileName);
    if (repoId) formData.append('repoId', repoId);
    if (folder) formData.append('folder', folder);
    formData.append('fileName', fileName);

    const res = await fetch(SeafileApi.apiUrl('/api/seafile/upload'), {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload to Seafile failed');
    return data;
  }

  static async getFiles(repoId, folder) {
    const params = new URLSearchParams();
    if (repoId) params.append('repoId', repoId);
    if (folder) params.append('folder', folder);

    const res = await fetch(SeafileApi.apiUrl(`/api/seafile/files?${params.toString()}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to list files');
    return data;
  }

  static async getFileUrl(repoId, filePath) {
    const params = new URLSearchParams({ repoId, path: filePath });
    const res = await fetch(SeafileApi.apiUrl(`/api/seafile/file-url?${params.toString()}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get file URL');
    return data.url;
  }

  // Seafile Public Share Link Generation (/api2/repos/:repo_id/file/shared-link/)
  static async createShareLink(repoId, filePath, options = {}) {
    const res = await fetch(SeafileApi.apiUrl('/api/seafile/share-link'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId,
        path: filePath,
        password: options.password || undefined,
        expire: options.expire || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create share link');
    return data;
  }

  // In-App Update Checker
  static async checkUpdates(simulate = false) {
    const url = SeafileApi.apiUrl(`/api/updates/check${simulate ? '?simulate=true' : ''}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to check for updates');
    return await res.json();
  }

  static getApkDownloadUrl() {
    return SeafileApi.apiUrl('/api/updates/download-apk');
  }

  static async getLocalSeafileInfo() {
    try {
      const res = await fetch(SeafileApi.apiUrl('/api/local-seafile'));
      return await res.json();
    } catch (e) {
      return { hasLocalSeafile: false, foundPaths: [] };
    }
  }
}

window.SeafileApi = SeafileApi;
