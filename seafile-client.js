const fs = require('fs');
const path = require('path');

const TOKEN_CACHE_FILE = process.env.SEAFILE_TOKEN_CACHE || path.join(__dirname, '.seafile-token-cache.json');

class SeafileClient {
  constructor(serverUrl, token) {
    this.serverUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    this.token = (token || '').trim();
  }

  // -------------------------------------------------------------
  // Persistent Token Caching Helpers
  // -------------------------------------------------------------
  static loadTokenCache() {
    try {
      if (fs.existsSync(TOKEN_CACHE_FILE)) {
        const raw = fs.readFileSync(TOKEN_CACHE_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[SeafileClient] Warning reading token cache:', e.message);
    }
    return {};
  }

  static saveTokenCache(cache) {
    try {
      fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
      console.warn('[SeafileClient] Warning saving token cache:', e.message);
    }
  }

  static getCacheKey(serverUrl, username = '') {
    const cleanUrl = (serverUrl || '').trim().toLowerCase().replace(/\/+$/, '');
    const cleanUser = (username || '').trim().toLowerCase();
    return cleanUser ? `${cleanUrl}::${cleanUser}` : cleanUrl;
  }

  static getCachedToken(serverUrl, username = '') {
    const cache = SeafileClient.loadTokenCache();
    const key = SeafileClient.getCacheKey(serverUrl, username);
    const entry = cache[key];
    if (!entry) return null;

    // Optional expiration check if set (default 30 days)
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      delete cache[key];
      SeafileClient.saveTokenCache(cache);
      return null;
    }
    return entry.token || null;
  }

  static setCachedToken(serverUrl, username = '', token, metadata = {}) {
    if (!serverUrl || !token) return;
    const cache = SeafileClient.loadTokenCache();
    const key = SeafileClient.getCacheKey(serverUrl, username);
    cache[key] = {
      token,
      serverUrl: serverUrl.trim().replace(/\/+$/, ''),
      username: username ? username.trim() : undefined,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days default
      ...metadata
    };
    SeafileClient.saveTokenCache(cache);
  }

  static clearCachedToken(serverUrl, username = '') {
    const cache = SeafileClient.loadTokenCache();
    const key = SeafileClient.getCacheKey(serverUrl, username);
    if (cache[key]) {
      delete cache[key];
      SeafileClient.saveTokenCache(cache);
    }
  }

  // -------------------------------------------------------------
  // Exponential Backoff Retry Fetch Wrapper
  // -------------------------------------------------------------
  static async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static async fetchWithRetry(url, options = {}, retryConfig = {}) {
    const {
      maxRetries = 3,
      initialDelayMs = 500,
      backoffFactor = 2,
      maxDelayMs = 4000
    } = retryConfig;

    let attempt = 0;
    let delay = initialDelayMs;

    while (true) {
      attempt++;
      try {
        const response = await fetch(url, options);

        // Retry on HTTP rate limit (429) or transient server errors (502, 503, 504)
        if (response.status === 429 || [502, 503, 504].includes(response.status)) {
          if (attempt <= maxRetries) {
            const jitter = Math.floor(Math.random() * 100);
            const waitTime = Math.min(delay, maxDelayMs) + jitter;
            console.warn(`[SeafileClient] HTTP ${response.status} from ${url}. Retrying attempt ${attempt}/${maxRetries} after ${waitTime}ms...`);
            await SeafileClient.sleep(waitTime);
            delay *= backoffFactor;
            continue;
          }
        }

        return response;
      } catch (err) {
        // Network connection dropped, timeout, ECONNRESET, etc.
        const isNetworkErr = err.name === 'FetchError' || 
                             err.name === 'TypeError' || 
                             err.code === 'ECONNRESET' || 
                             err.code === 'ETIMEDOUT' ||
                             err.message?.includes('fetch failed');

        if (isNetworkErr && attempt <= maxRetries) {
          const jitter = Math.floor(Math.random() * 100);
          const waitTime = Math.min(delay, maxDelayMs) + jitter;
          console.warn(`[SeafileClient] Network error "${err.message}" on ${url}. Retrying attempt ${attempt}/${maxRetries} in ${waitTime}ms...`);
          await SeafileClient.sleep(waitTime);
          delay *= backoffFactor;
          continue;
        }

        throw err;
      }
    }
  }

  getHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (this.token) {
      headers['Authorization'] = `Token ${this.token}`;
    }
    return headers;
  }

  // Obtain an auth token using username and password with persistent caching
  static async authenticate(serverUrl, username, password) {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    const cleanUser = username.trim();

    const url = `${cleanUrl}/api2/auth-token/`;
    const body = new URLSearchParams({
      username: cleanUser,
      password: password
    });

    const response = await SeafileClient.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.non_field_errors?.[0] || errJson.detail || errText || errorMsg;
      } catch (e) {}
      throw new Error(`Authentication failed: ${errorMsg}`);
    }

    const data = await response.json();
    const token = data.token;

    // Cache the newly acquired token persistently
    SeafileClient.setCachedToken(cleanUrl, cleanUser, token);

    return token;
  }

  // Health check: test server connectivity, latency, and auth token health
  async checkHealth() {
    const startTime = Date.now();
    const result = {
      healthy: false,
      serverUrl: this.serverUrl,
      hasToken: Boolean(this.token),
      latencyMs: 0,
      status: 'unknown',
      account: null,
      error: null
    };

    if (!this.serverUrl) {
      result.error = 'No Seafile server URL configured';
      result.status = 'unconfigured';
      return result;
    }

    try {
      // First attempt: check ping endpoint (/api2/ping/)
      let pingOk = false;
      try {
        const pingUrl = `${this.serverUrl}/api2/ping/`;
        const pingRes = await SeafileClient.fetchWithRetry(pingUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/plain, application/json' }
        }, { maxRetries: 2, initialDelayMs: 300 });

        if (pingRes.ok) {
          pingOk = true;
        }
      } catch (e) {
        // Ping might be disabled or require auth, proceed to account check
      }

      // If token is present, validate account info
      if (this.token) {
        const account = await this.getAccountInfo();
        result.healthy = true;
        result.status = 'connected';
        result.account = account;
      } else {
        result.healthy = pingOk;
        result.status = pingOk ? 'server_reachable_no_token' : 'server_unreachable';
      }

      result.latencyMs = Date.now() - startTime;
      return result;
    } catch (err) {
      result.latencyMs = Date.now() - startTime;
      result.healthy = false;
      result.status = 'error';
      result.error = err.message;
      return result;
    }
  }

  // Validate the current token and retrieve account info
  async getAccountInfo() {
    const url = `${this.serverUrl}/api2/account/info/`;
    const response = await SeafileClient.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders({ 'Accept': 'application/json' })
    });

    if (!response.ok) {
      throw new Error(`Failed to get account info: HTTP ${response.status}`);
    }

    return await response.json();
  }

  // List all repositories/libraries the user has access to
  async listRepos() {
    const url = `${this.serverUrl}/api2/repos/`;
    const response = await SeafileClient.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders({ 'Accept': 'application/json' })
    });

    if (!response.ok) {
      throw new Error(`Failed to list libraries: HTTP ${response.status}`);
    }

    return await response.json();
  }

  // Auto-library selection heuristic: finds or selects the best library for scans
  async selectBestLibrary() {
    const repos = await this.listRepos();
    if (!repos || repos.length === 0) {
      return null;
    }

    // Priority 1: Match dedicated scanner / rocketbook libraries
    const scanMatch = repos.find(r => 
      /rocketscan|notescan|rocketbook/i.test(r.name) && (r.permission === 'rw' || !r.permission)
    );
    if (scanMatch) return scanMatch;

    // Priority 2: Match notes / personal / my library
    const notesMatch = repos.find(r => 
      /notes|my library|personal/i.test(r.name) && (r.permission === 'rw' || !r.permission)
    );
    if (notesMatch) return notesMatch;

    // Priority 3: First writable library (rw)
    const writable = repos.find(r => r.permission === 'rw');
    if (writable) return writable;

    // Priority 4: Fallback to first repo
    return repos[0];
  }

  // Ensure a directory exists (creates if not found)
  async ensureDir(repoId, parentDir, dirName) {
    try {
      const cleanParent = parentDir.endsWith('/') ? parentDir : `${parentDir}/`;
      const url = `${this.serverUrl}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(cleanParent)}`;
      const formData = new URLSearchParams({
        operation: 'mkdir',
        name: dirName
      });

      const response = await SeafileClient.fetchWithRetry(url, {
        method: 'POST',
        headers: this.getHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }),
        body: formData.toString()
      });

      // Status 200/201 means created, 400 with 'already exists' is fine
      return true;
    } catch (e) {
      // Ignore if directory already exists
      return false;
    }
  }

  // Get the upload link for a repo and directory
  async getUploadLink(repoId, parentDir = '/') {
    const cleanDir = parentDir.startsWith('/') ? parentDir : `/${parentDir}`;
    const url = `${this.serverUrl}/api2/repos/${repoId}/upload-link/?p=${encodeURIComponent(cleanDir)}`;
    const response = await SeafileClient.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get upload link: HTTP ${response.status}`);
    }

    let link = await response.text();
    link = link.replace(/^"|"$/g, '').trim();
    return link;
  }

  // Upload a file buffer or stream directly to Seafile
  async uploadFile(repoId, parentDir, fileName, fileBuffer, mimeType = 'application/pdf') {
    const uploadUrl = await this.getUploadLink(repoId, parentDir);
    const cleanDir = parentDir.startsWith('/') ? parentDir : `/${parentDir}`;

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('parent_dir', cleanDir);
    formData.append('replace', '0');

    const response = await SeafileClient.fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload failed: HTTP ${response.status} - ${errText}`);
    }

    return {
      success: true,
      fileName,
      path: `${cleanDir.replace(/\/+$/, '')}/${fileName}`
    };
  }

  // List files in a repo directory
  async listFiles(repoId, dirPath = '/') {
    const cleanDir = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
    const url = `${this.serverUrl}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(cleanDir)}`;
    const response = await SeafileClient.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders({ 'Accept': 'application/json' })
    });

    if (!response.ok) {
      throw new Error(`Failed to list directory contents: HTTP ${response.status}`);
    }

    return await response.json();
  }

  // Get download link for a file
  async getFileDownloadLink(repoId, filePath) {
    const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const url = `${this.serverUrl}/api2/repos/${repoId}/file/?p=${encodeURIComponent(cleanPath)}&reuse=1`;
    const response = await SeafileClient.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get file link: HTTP ${response.status}`);
    }

    let link = await response.text();
    return link.replace(/^"|"$/g, '').trim();
  }

  // -------------------------------------------------------------
  // Seafile Public Share Link Generation (/api2/repos/:repo_id/file/shared-link/)
  // -------------------------------------------------------------
  async createShareLink(repoId, filePath, options = {}) {
    const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    
    // First try: Classic Seafile PUT /api2/repos/:repo_id/file/shared-link/?p=...
    const url = `${this.serverUrl}/api2/repos/${repoId}/file/shared-link/?p=${encodeURIComponent(cleanPath)}`;

    try {
      const bodyParams = new URLSearchParams();
      if (options.password) bodyParams.append('password', options.password);
      if (options.expire) bodyParams.append('expire', options.expire);

      const putRes = await SeafileClient.fetchWithRetry(url, {
        method: 'PUT',
        headers: this.getHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json, text/plain, */*'
        }),
        body: bodyParams.toString()
      });

      if (putRes.ok) {
        // Seafile may return the URL as JSON, raw text, or Location header
        const locationHeader = putRes.headers.get('location');
        if (locationHeader) {
          return { shareUrl: locationHeader, repoId, path: cleanPath };
        }

        const resText = await putRes.text();
        try {
          const resJson = JSON.parse(resText);
          const shareUrl = resJson.link || resJson.shared_link || resJson.url;
          if (shareUrl) {
            return { shareUrl, token: resJson.token, repoId, path: cleanPath };
          }
        } catch (e) {
          // resText might be clean URL or quoted URL
          const cleanLink = resText.replace(/^"|"$/g, '').trim();
          if (cleanLink.startsWith('http')) {
            return { shareUrl: cleanLink, repoId, path: cleanPath };
          }
        }
      }
    } catch (e) {
      console.warn('[SeafileClient] PUT shared-link error, attempting GET fallback:', e.message);
    }

    // Second try: GET existing shared link if already exists
    try {
      const getRes = await SeafileClient.fetchWithRetry(url, {
        method: 'GET',
        headers: this.getHeaders({ 'Accept': 'application/json, text/plain, */*' })
      });

      if (getRes.ok) {
        const getText = await getRes.text();
        try {
          const getJson = JSON.parse(getText);
          const shareUrl = getJson.link || getJson.shared_link || getJson.url || (Array.isArray(getJson) && getJson[0]?.link);
          if (shareUrl) {
            return { shareUrl, token: getJson.token, repoId, path: cleanPath };
          }
        } catch (e) {
          const cleanLink = getText.replace(/^"|"$/g, '').trim();
          if (cleanLink.startsWith('http')) {
            return { shareUrl: cleanLink, repoId, path: cleanPath };
          }
        }
      }
    } catch (e) {
      console.warn('[SeafileClient] GET shared-link error:', e.message);
    }

    // Third try: Seafile v2.1 API (/api/v2.1/share-links/)
    try {
      const v21Url = `${this.serverUrl}/api/v2.1/share-links/`;
      const postRes = await SeafileClient.fetchWithRetry(v21Url, {
        method: 'POST',
        headers: this.getHeaders({
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }),
        body: JSON.stringify({
          repo_id: repoId,
          path: cleanPath,
          permissions: { can_edit: false, can_download: true }
        })
      });

      if (postRes.ok) {
        const v21Data = await postRes.json();
        const shareUrl = v21Data.link || v21Data.shared_link;
        if (shareUrl) {
          return { shareUrl, token: v21Data.token, repoId, path: cleanPath };
        }
      }
    } catch (e) {
      console.warn('[SeafileClient] v2.1 share-links error:', e.message);
    }

    // Fallback: Build standard Seafile web preview / common share URL
    const fallbackUrl = `${this.serverUrl}/#common/lib/${repoId}${encodeURI(cleanPath)}`;
    return {
      shareUrl: fallbackUrl,
      repoId,
      path: cleanPath,
      fallback: true
    };
  }
}

module.exports = SeafileClient;
