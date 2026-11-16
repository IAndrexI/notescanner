/**
 * SeafileApi: Bridge between frontend UI and Seafile Backend Proxy
 */
class SeafileApi {
  static async getNetworkInfo() {
    const res = await fetch('/api/network-info');
    if (!res.ok) throw new Error('Failed to load network info');
    return await res.json();
  }

  static async getConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load config');
    return await res.json();
  }

  static async saveConfig(cfg) {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    if (!res.ok) throw new Error('Failed to save config');
    return await res.json();
  }

  static async login(serverUrl, username, password) {
    const res = await fetch('/api/seafile/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  }

  static async testConnection(serverUrl, token) {
    const res = await fetch('/api/seafile/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, token })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection failed');
    return data;
  }

  static async getRepos() {
    const res = await fetch('/api/seafile/repos');
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

    const res = await fetch('/api/seafile/upload', {
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

    const res = await fetch(`/api/seafile/files?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to list files');
    return data;
  }

  static async getFileUrl(repoId, filePath) {
    const params = new URLSearchParams({ repoId, path: filePath });
    const res = await fetch(`/api/seafile/file-url?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get file URL');
    return data.url;
  }

  static async getLocalSeafileInfo() {
    try {
      const res = await fetch('/api/local-seafile');
      return await res.json();
    } catch (e) {
      return { hasLocalSeafile: false, foundPaths: [] };
    }
  }
}

window.SeafileApi = SeafileApi;
