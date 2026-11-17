/**
 * SeafileApi: Direct Seafile REST API Client with Local Proxy Fallback & Direct Links
 * Works standalone on Android (Capacitor), mobile/desktop browsers, and with local Node.js proxy.
 */
(function (root) {
  function resolveStorageManager() {
    if (typeof StorageManager !== 'undefined') return StorageManager;
    if (root && root.StorageManager) return root.StorageManager;
    if (typeof require === 'function') {
      try {
        return require('./storage.js');
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  class SeafileApi {
    // -------------------------------------------------------------
    // Base URL & Local Storage Settings Helpers
    // -------------------------------------------------------------
    static getBaseUrl() {
      try {
        const customServer = typeof localStorage !== 'undefined'
          ? localStorage.getItem('notescan_backend_url')
          : null;
        if (customServer) {
          return customServer.replace(/\/+$/, '');
        }
      } catch (e) {}
      return '';
    }

    static setBaseUrl(url) {
      if (typeof localStorage === 'undefined') return;
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

    static _getSettings() {
      const SM = resolveStorageManager();
      if (SM && typeof SM.getSettings === 'function') {
        return SM.getSettings();
      }
      return {
        serverUrl: 'https://seafile.protutech.vip',
        token: '',
        hasToken: false,
        repoId: '',
        repoName: '',
        folder: '/',
        autoUpload: true,
        filterDefault: 'magic',
        presets: null,
        account: null,
        directLinks: []
      };
    }

    static _saveSettings(partial) {
      const SM = resolveStorageManager();
      if (SM && typeof SM.saveSettings === 'function') {
        return SM.saveSettings(partial);
      }
      return { ...SeafileApi._getSettings(), ...partial };
    }

    static _normalizeServerUrl(url) {
      const trimmed = (url || '').trim().replace(/\/+$/, '');
      if (!trimmed) return '';
      if (!/^https?:\/\//i.test(trimmed)) {
        return `https://${trimmed}`;
      }
      return trimmed;
    }

    /**
     * Sanitize Seafile transfer URLs (upload-link / file download links) returned by Seafile API.
     * If the returned URL uses http:// or has a hostname/host mismatch against serverUrl,
     * rewrite it to https://${cleanUrlHost}/seafhttp/... so outside-network transfers succeed securely.
     */
    static _sanitizeUploadUrl(rawUrl, serverUrl) {
      if (!rawUrl || typeof rawUrl !== 'string') return '';
      const trimmed = rawUrl.trim();
      if (!trimmed) return '';

      const cleanServer = SeafileApi._normalizeServerUrl(serverUrl);
      if (!cleanServer) return trimmed;

      try {
        const baseParsed = new URL(cleanServer);
        const cleanUrlHost = baseParsed.host;
        const targetParsed = new URL(trimmed, baseParsed.origin);

        const usesHttp = targetParsed.protocol === 'http:';
        const hostMismatch = targetParsed.hostname !== baseParsed.hostname || targetParsed.host !== baseParsed.host;

        if (usesHttp || hostMismatch) {
          let pathname = targetParsed.pathname || '/';
          if (!pathname.startsWith('/seafhttp/') && pathname !== '/seafhttp') {
            pathname = `/seafhttp${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
          }
          return `https://${cleanUrlHost}${pathname}${targetParsed.search}${targetParsed.hash}`;
        }

        return targetParsed.toString();
      } catch (e) {
        return trimmed;
      }
    }

    static _normalizeFolder(folder) {
      const trimmed = (folder || '/').trim();
      if (!trimmed || trimmed === '/') return '/';
      return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') || '/' : `/${trimmed.replace(/\/+$/, '')}`;
    }

    static _getAuthContext(serverUrl, token) {
      const settings = SeafileApi._getSettings();
      const cleanUrl = SeafileApi._normalizeServerUrl(serverUrl !== undefined && serverUrl !== null && serverUrl !== '' ? serverUrl : settings.serverUrl);
      const activeToken = (token !== undefined && token !== null && String(token).trim() !== '')
        ? String(token).trim()
        : (settings.token || '').trim();
      return { serverUrl: cleanUrl, token: activeToken, settings };
    }

    static _isNetworkError(err) {
      if (!err) return false;
      const msg = String(err.message || '').toLowerCase();
      return (
        err.name === 'TypeError' ||
        err.name === 'FetchError' ||
        err.name === 'AbortError' ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('network request failed') ||
        msg.includes('load failed') ||
        msg.includes('fetch failed') ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('cors')
      );
    }

    static async _parseErrorResponse(res, fallbackMsg) {
      let detail = '';
      try {
        const text = await res.text();
        if (text) {
          try {
            const json = JSON.parse(text);
            detail =
              (Array.isArray(json.non_field_errors) && json.non_field_errors[0]) ||
              json.error ||
              json.error_msg ||
              json.detail ||
              json.message ||
              text;
          } catch (e) {
            detail = text;
          }
        }
      } catch (e) {}
      return detail ? `${fallbackMsg}: ${detail}` : `${fallbackMsg} (HTTP ${res.status})`;
    }

    static async _fetchProxyJson(path, options = {}) {
      const res = await fetch(SeafileApi.apiUrl(path), options);
      const contentType = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Local proxy unavailable at ${path} (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || `Proxy request failed (HTTP ${res.status})`);
      }
      return data;
    }

    static _selectBestLibrary(repos) {
      if (!Array.isArray(repos) || repos.length === 0) return null;

      const scanMatch = repos.find(r =>
        /rocketscan|notescan|rocketbook/i.test(r.name) && (r.permission === 'rw' || !r.permission)
      );
      if (scanMatch) return scanMatch;

      const notesMatch = repos.find(r =>
        /notes|my library|personal|scanned/i.test(r.name) && (r.permission === 'rw' || !r.permission)
      );
      if (notesMatch) return notesMatch;

      const writable = repos.find(r => r.permission === 'rw');
      if (writable) return writable;

      return repos[0];
    }

    static isLoggedIn() {
      const settings = SeafileApi._getSettings();
      return Boolean(settings.serverUrl && (settings.token || settings.hasToken));
    }

    static logout() {
      const SM = resolveStorageManager();
      if (SM && typeof SM.clearSeafileAuth === 'function') {
        return SM.clearSeafileAuth();
      }
      return SeafileApi._saveSettings({ token: null, clearToken: true, account: null });
    }

    // -------------------------------------------------------------
    // Direct Links Helpers (delegated to StorageManager)
    // -------------------------------------------------------------
    static getDirectLinks() {
      const SM = resolveStorageManager();
      if (SM && typeof SM.getDirectLinks === 'function') {
        return SM.getDirectLinks();
      }
      return SeafileApi._getSettings().directLinks || [];
    }

    static saveDirectLinks(links) {
      const SM = resolveStorageManager();
      if (SM && typeof SM.saveDirectLinks === 'function') {
        return SM.saveDirectLinks(links);
      }
      return SeafileApi._saveSettings({ directLinks: links }).directLinks || [];
    }

    static addDirectLink(nameOrObj, url) {
      const SM = resolveStorageManager();
      if (SM && typeof SM.addDirectLink === 'function') {
        return SM.addDirectLink(nameOrObj, url);
      }
      const links = SeafileApi.getDirectLinks();
      const entry = typeof nameOrObj === 'object'
        ? { id: `dl_${Date.now()}`, name: nameOrObj.name || nameOrObj.url, url: nameOrObj.url }
        : { id: `dl_${Date.now()}`, name: nameOrObj || url, url };
      links.push(entry);
      SeafileApi.saveDirectLinks(links);
      return entry;
    }

    static removeDirectLink(idOrIndexOrUrl) {
      const SM = resolveStorageManager();
      if (SM && typeof SM.removeDirectLink === 'function') {
        return SM.removeDirectLink(idOrIndexOrUrl);
      }
      const links = SeafileApi.getDirectLinks().filter((l, idx) =>
        typeof idOrIndexOrUrl === 'number'
          ? idx !== idOrIndexOrUrl
          : l.id !== idOrIndexOrUrl && l.url !== idOrIndexOrUrl
      );
      return SeafileApi.saveDirectLinks(links);
    }

    // -------------------------------------------------------------
    // Config & Network Info (Works offline/standalone without Node.js)
    // -------------------------------------------------------------
    static async getNetworkInfo() {
      try {
        return await SeafileApi._fetchProxyJson('/api/network-info');
      } catch (e) {
        const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
          ? window.location.origin
          : '';
        return {
          localIp: '',
          port: null,
          connectUrl: origin,
          qrCode: ''
        };
      }
    }

    static async getConfig() {
      const localCfg = SeafileApi._getSettings();
      try {
        const serverCfg = await SeafileApi._fetchProxyJson('/api/config');
        const merged = {
          ...localCfg,
          ...serverCfg,
          // Preserve client-side token and direct links
          token: localCfg.token || '',
          hasToken: Boolean(localCfg.token || serverCfg.hasToken),
          directLinks: SeafileApi.getDirectLinks()
        };
        SeafileApi._saveSettings({
          serverUrl: merged.serverUrl,
          repoId: merged.repoId,
          repoName: merged.repoName,
          folder: merged.folder,
          autoUpload: merged.autoUpload,
          filterDefault: merged.filterDefault,
          presets: merged.presets,
          hasToken: merged.hasToken
        });
        return merged;
      } catch (e) {
        // Standalone / Android mode: return local settings directly
        return localCfg;
      }
    }

    static async saveConfig(cfg = {}) {
      const savedLocal = SeafileApi._saveSettings(cfg);
      try {
        const proxyRes = await SeafileApi._fetchProxyJson('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg)
        });
        if (proxyRes && proxyRes.config) {
          const merged = {
            ...savedLocal,
            ...proxyRes.config,
            token: savedLocal.token || '',
            hasToken: Boolean(savedLocal.token || proxyRes.config.hasToken),
            directLinks: SeafileApi.getDirectLinks()
          };
          return { success: true, config: merged };
        }
      } catch (e) {
        // No local server available; local storage save succeeded
      }
      return { success: true, config: savedLocal };
    }

    // -------------------------------------------------------------
    // Direct Seafile REST API Methods (with local proxy fallback)
    // -------------------------------------------------------------

    /**
     * Login via POST ${serverUrl}/api2/auth-token/ with username and password.
     * Falls back to local /api/seafile/login if direct call fails due to network/CORS.
     */
    static async login(serverUrl, username, password) {
      const cleanUrl = SeafileApi._normalizeServerUrl(serverUrl);
      const cleanUser = (username || '').trim();
      if (!cleanUrl || !cleanUser || !password) {
        throw new Error('Server URL, username, and password are required.');
      }

      try {
        const body = new URLSearchParams({
          username: cleanUser,
          password: String(password)
        });

        const res = await fetch(`${cleanUrl}/api2/auth-token/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: body.toString()
        });

        if (!res.ok) {
          const msg = await SeafileApi._parseErrorResponse(res, 'Authentication failed');
          throw new Error(msg);
        }

        const data = await res.json();
        const token = data && data.token;
        if (!token) {
          throw new Error('Seafile did not return an auth token.');
        }

        // Fetch account info directly
        let account = { email: cleanUser, name: cleanUser };
        try {
          const accRes = await fetch(`${cleanUrl}/api2/account/info/`, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${token}`,
              'Accept': 'application/json'
            }
          });
          if (accRes.ok) {
            account = await accRes.json();
          }
        } catch (e) {}

        // Auto-select library if none is currently saved
        const currentSettings = SeafileApi._getSettings();
        let repoId = currentSettings.repoId || '';
        let repoName = currentSettings.repoName || '';
        if (!repoId) {
          try {
            const repos = await SeafileApi.getRepos(cleanUrl, token);
            const selected = SeafileApi._selectBestLibrary(repos);
            if (selected) {
              repoId = selected.id;
              repoName = selected.name;
            }
          } catch (e) {}
        }

        SeafileApi._saveSettings({
          serverUrl: cleanUrl,
          token,
          hasToken: true,
          account,
          repoId,
          repoName
        });

        // Best-effort sync to local proxy config if running alongside Node server
        SeafileApi._fetchProxyJson('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: cleanUrl, token, repoId, repoName })
        }).catch(() => {});

        return {
          success: true,
          token,
          account,
          repoId,
          repoName
        };
      } catch (directErr) {
        if (!SeafileApi._isNetworkError(directErr)) {
          throw directErr;
        }
        // Fallback to local Node.js proxy
        try {
          const proxyData = await SeafileApi._fetchProxyJson('/api/seafile/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverUrl: cleanUrl, username: cleanUser, password })
          });
          SeafileApi._saveSettings({
            serverUrl: cleanUrl,
            token: proxyData.token || '',
            hasToken: Boolean(proxyData.token),
            account: proxyData.account || { email: cleanUser },
            repoId: proxyData.repoId || '',
            repoName: proxyData.repoName || ''
          });
          return proxyData;
        } catch (proxyErr) {
          throw new Error(directErr.message || proxyErr.message || 'Login failed');
        }
      }
    }

    /**
     * Test connection via GET ${serverUrl}/api2/account/info/ with Authorization: Token <token>.
     * Falls back to local /api/seafile/test if direct fails or no local token is stored.
     */
    static async testConnection(serverUrl, token) {
      const { serverUrl: cleanUrl, token: activeToken, settings } = SeafileApi._getAuthContext(serverUrl, token);
      if (!cleanUrl) {
        throw new Error('Seafile server URL is required.');
      }

      if (activeToken) {
        try {
          const res = await fetch(`${cleanUrl}/api2/account/info/`, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${activeToken}`,
              'Accept': 'application/json'
            }
          });

          if (!res.ok) {
            const msg = await SeafileApi._parseErrorResponse(res, 'Connection failed');
            throw new Error(msg);
          }

          const account = await res.json();
          let repos = [];
          try {
            repos = await SeafileApi.getRepos(cleanUrl, activeToken);
          } catch (e) {}

          let suggestedRepo = null;
          if (!settings.repoId || (repos.length > 0 && !repos.some(r => r.id === settings.repoId))) {
            suggestedRepo = SeafileApi._selectBestLibrary(repos);
          }

          SeafileApi._saveSettings({
            serverUrl: cleanUrl,
            token: activeToken,
            hasToken: true,
            account,
            ...(suggestedRepo ? { repoId: suggestedRepo.id, repoName: suggestedRepo.name } : {})
          });

          return {
            success: true,
            account,
            librariesCount: repos.length,
            repos,
            suggestedRepo
          };
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            throw directErr;
          }
        }
      }

      // Fallback to local proxy (or if token lives only in server config.json)
      try {
        const proxyData = await SeafileApi._fetchProxyJson('/api/seafile/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: cleanUrl, token: activeToken || undefined, autoSaveRepo: true })
        });
        if (proxyData && proxyData.account) {
          SeafileApi._saveSettings({
            serverUrl: cleanUrl,
            hasToken: true,
            account: proxyData.account,
            ...(activeToken ? { token: activeToken } : {}),
            ...(proxyData.suggestedRepo ? { repoId: proxyData.suggestedRepo.id, repoName: proxyData.suggestedRepo.name } : {})
          });
        }
        return proxyData;
      } catch (proxyErr) {
        if (!activeToken) {
          throw new Error('Please log in or enter an API token to test Seafile connection.');
        }
        throw new Error(proxyErr.message || 'Connection failed');
      }
    }

    // Alias matching spec naming
    static async test(serverUrl, token) {
      return SeafileApi.testConnection(serverUrl, token);
    }

    /**
     * Health check: verifies ping, account info, and active library directly with fallback to proxy.
     */
    static async checkHealth() {
      const startTime = Date.now();
      const { serverUrl: cleanUrl, token: activeToken, settings } = SeafileApi._getAuthContext();

      if (cleanUrl && activeToken) {
        try {
          try {
            await fetch(`${cleanUrl}/api2/ping/`, { method: 'GET' });
          } catch (e) {}

          const accRes = await fetch(`${cleanUrl}/api2/account/info/`, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${activeToken}`,
              'Accept': 'application/json'
            }
          });

          if (!accRes.ok) {
            throw new Error(`HTTP ${accRes.status}`);
          }

          const account = await accRes.json();
          let libraryInfo = null;
          try {
            const repos = await SeafileApi.getRepos(cleanUrl, activeToken);
            const activeRepo = repos.find(r => r.id === settings.repoId);
            libraryInfo = {
              totalLibraries: repos.length,
              activeRepoFound: Boolean(activeRepo),
              activeRepoName: activeRepo ? activeRepo.name : settings.repoName
            };
          } catch (e) {}

          return {
            healthy: true,
            status: 'connected',
            serverUrl: cleanUrl,
            hasToken: true,
            latencyMs: Date.now() - startTime,
            account,
            activeRepoId: settings.repoId,
            activeRepoName: settings.repoName,
            libraryInfo
          };
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            return {
              healthy: false,
              status: 'error',
              serverUrl: cleanUrl,
              hasToken: true,
              latencyMs: Date.now() - startTime,
              error: directErr.message
            };
          }
        }
      }

      // Proxy fallback
      try {
        return await SeafileApi._fetchProxyJson('/api/seafile/health');
      } catch (e) {
        return {
          healthy: false,
          status: activeToken ? 'unreachable' : 'unconfigured',
          serverUrl: cleanUrl,
          hasToken: Boolean(activeToken),
          latencyMs: Date.now() - startTime,
          message: activeToken
            ? 'Could not reach Seafile server.'
            : 'Seafile login not configured (optional — you can still scan, export, and use Direct Links).'
        };
      }
    }

    /**
     * List libraries via GET ${serverUrl}/api2/repos/ with Authorization: Token <token>.
     * Falls back to local /api/seafile/repos if direct fails.
     */
    static async getRepos(serverUrl, token) {
      const { serverUrl: cleanUrl, token: activeToken } = SeafileApi._getAuthContext(serverUrl, token);

      if (cleanUrl && activeToken) {
        try {
          const res = await fetch(`${cleanUrl}/api2/repos/`, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${activeToken}`,
              'Accept': 'application/json'
            }
          });
          if (!res.ok) {
            const msg = await SeafileApi._parseErrorResponse(res, 'Failed to list libraries');
            throw new Error(msg);
          }
          return await res.json();
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            throw directErr;
          }
        }
      }

      // Fallback to local proxy
      return await SeafileApi._fetchProxyJson('/api/seafile/repos');
    }

    static async autoSelectRepo(serverUrl, token) {
      try {
        const repos = await SeafileApi.getRepos(serverUrl, token);
        const selected = SeafileApi._selectBestLibrary(repos);
        if (!selected) {
          throw new Error('No libraries available in this Seafile account');
        }
        SeafileApi._saveSettings({
          repoId: selected.id,
          repoName: selected.name
        });
        return {
          success: true,
          repoId: selected.id,
          repoName: selected.name,
          selectedRepo: selected
        };
      } catch (directErr) {
        if (!SeafileApi._isNetworkError(directErr)) {
          throw directErr;
        }
        return await SeafileApi._fetchProxyJson('/api/seafile/auto-select-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    static async _ensureDirDirect(serverUrl, token, repoId, folder) {
      const cleanFolder = SeafileApi._normalizeFolder(folder);
      if (!cleanFolder || cleanFolder === '/') return;

      const parts = cleanFolder.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      let curr = '/';
      for (const part of parts) {
        try {
          const url = `${serverUrl}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(curr)}`;
          const body = new URLSearchParams({ operation: 'mkdir', name: part });
          await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json'
            },
            body: body.toString()
          });
        } catch (e) {
          // Best-effort; ignore if directory already exists
        }
        curr = `${curr}${part}/`;
      }
    }

    /**
     * Send a file directly to any URL (Seafile public upload link, Seafile upload-api URL,
     * webhook, or custom HTTP endpoint) without requiring Seafile login.
     */
    static async sendToDirectLink(url, fileBlob, fileName, options = {}) {
      if (!url || typeof url !== 'string' || !url.trim()) {
        throw new Error('Direct link URL is required.');
      }
      if (!fileBlob) {
        throw new Error('File data is required.');
      }

      let cleanUrl = url.trim();
      if (!/^https?:\/\//i.test(cleanUrl) && !cleanUrl.startsWith('/')) {
        cleanUrl = `https://${cleanUrl}`;
      }

      const finalName = (fileName && String(fileName).trim()) || `Scan_${Date.now()}.pdf`;
      const parentDir = SeafileApi._normalizeFolder(options.parentDir || '/');
      let targetUploadUrl = cleanUrl;

      // Resolve Seafile public shared upload link (/u/d/<token>/) to its upload-api endpoint
      const publicUploadMatch = cleanUrl.match(/^(https?:\/\/[^\/]+)\/u\/d\/([a-zA-Z0-9_-]+)\/?/i);
      if (publicUploadMatch) {
        const origin = publicUploadMatch[1];
        const shareToken = publicUploadMatch[2];
        const resolveCandidates = [
          `${origin}/api/v2.1/upload-links/${shareToken}/upload/`,
          `${origin}/ajax/u/d/${shareToken}/upload/`
        ];
        for (const candidate of resolveCandidates) {
          try {
            const resolveRes = await fetch(candidate, {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            });
            if (resolveRes.ok) {
              const ct = resolveRes.headers && resolveRes.headers.get ? (resolveRes.headers.get('content-type') || '') : '';
              if (ct.includes('application/json')) {
                const resolvedData = await resolveRes.json();
                const link = resolvedData.upload_link || resolvedData.link;
                if (link && typeof link === 'string') {
                  targetUploadUrl = origin.startsWith('https://')
                    ? SeafileApi._sanitizeUploadUrl(link, origin)
                    : link.trim();
                  break;
                }
              }
            }
          } catch (e) {
            // Try next candidate or fall through to posting directly
          }
        }
      }

      const method = options.method || 'POST';
      let res;

      if (options.binary === true) {
        const headers = {
          'Content-Type': fileBlob.type || 'application/octet-stream',
          'X-File-Name': finalName,
          ...(options.headers || {})
        };
        res = await fetch(targetUploadUrl, {
          method,
          headers,
          body: fileBlob
        });
      } else {
        const formData = new FormData();
        formData.append('file', fileBlob, finalName);
        formData.append('fileName', finalName);
        formData.append('parent_dir', parentDir);
        formData.append('replace', options.replace !== undefined ? String(options.replace) : '0');

        const fetchOpts = { method, body: formData };
        if (options.headers && Object.keys(options.headers).length > 0) {
          fetchOpts.headers = options.headers;
        }
        res = await fetch(targetUploadUrl, fetchOpts);
      }

      if (!res.ok) {
        const errMsg = await SeafileApi._parseErrorResponse(res, 'Direct link upload failed');
        throw new Error(errMsg);
      }

      let responseBody = null;
      try {
        const ct = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
        if (ct.includes('application/json')) {
          responseBody = await res.json();
        } else {
          responseBody = await res.text();
        }
      } catch (e) {}

      return {
        success: true,
        status: res.status,
        url: cleanUrl,
        uploadUrl: targetUploadUrl,
        fileName: finalName,
        message: 'Sent to direct link successfully',
        response: responseBody
      };
    }

    /**
     * Upload a file:
     * a) If an optional direct upload link is provided (options.directUploadLink / options string / URL),
     *    POST directly to that URL without requiring Seafile login.
     * b) Otherwise, get upload link via GET ${serverUrl}/api2/repos/${repoId}/upload-link/?p=${folder}
     *    with header 'Authorization: Token ' + token, then POST the file to that link.
     * Falls back to local /api/seafile/upload proxy if direct fails due to network/CORS.
     */
    static async uploadFile(fileBlob, fileName, repoId, folder, options = {}) {
      const opts = typeof options === 'string' ? { directUploadLink: options } : (options || {});
      const directUploadLink =
        opts.directUploadLink ||
        opts.uploadUrl ||
        opts.directUrl ||
        (typeof repoId === 'string' && /^https?:\/\//i.test(repoId.trim()) ? repoId.trim() : null);

      // (a) Direct upload link provided — no Seafile login required
      if (directUploadLink) {
        return await SeafileApi.sendToDirectLink(directUploadLink, fileBlob, fileName, {
          parentDir: folder || '/',
          ...opts
        });
      }

      // (b) Authenticated Seafile REST API upload
      const { serverUrl: cleanUrl, token: activeToken, settings } = SeafileApi._getAuthContext(opts.serverUrl, opts.token);
      let targetRepoId = repoId || settings.repoId;
      const cleanFolder = SeafileApi._normalizeFolder(folder || settings.folder || '/');
      const finalName = fileName || `Scan_${Date.now()}.pdf`;

      if (cleanUrl && activeToken) {
        try {
          if (!targetRepoId) {
            const auto = await SeafileApi.autoSelectRepo(cleanUrl, activeToken);
            targetRepoId = auto.repoId;
          }
          if (!targetRepoId) {
            throw new Error('No target Seafile library (repoId) specified or found.');
          }

          await SeafileApi._ensureDirDirect(cleanUrl, activeToken, targetRepoId, cleanFolder);

          const linkEndpoint = `${cleanUrl}/api2/repos/${targetRepoId}/upload-link/?p=${encodeURIComponent(cleanFolder)}`;
          const linkRes = await fetch(linkEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${activeToken}`
            }
          });

          if (!linkRes.ok) {
            const msg = await SeafileApi._parseErrorResponse(linkRes, 'Failed to get upload link');
            throw new Error(msg);
          }

          let uploadUrl = '';
          const linkText = await linkRes.text();
          try {
            const parsed = JSON.parse(linkText);
            if (typeof parsed === 'string') {
              uploadUrl = parsed.trim();
            } else if (parsed && (parsed.upload_link || parsed.link || parsed.url)) {
              uploadUrl = String(parsed.upload_link || parsed.link || parsed.url).trim();
            }
          } catch (e) {
            uploadUrl = linkText.replace(/^"|"$/g, '').trim();
          }

          if (!uploadUrl) {
            throw new Error('Seafile returned an empty upload link.');
          }
          uploadUrl = SeafileApi._sanitizeUploadUrl(uploadUrl, cleanUrl);

          const formData = new FormData();
          formData.append('file', fileBlob, finalName);
          formData.append('parent_dir', cleanFolder);
          formData.append('replace', '0');

          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
          });

          if (!uploadRes.ok) {
            const msg = await SeafileApi._parseErrorResponse(uploadRes, 'Upload to Seafile failed');
            throw new Error(msg);
          }

          const cleanFolderForUrl = cleanFolder.replace(/^\/+|\/+$/g, '');
          const cleanPath = cleanFolderForUrl ? `${cleanFolderForUrl}/${finalName}` : finalName;
          const viewUrl = `${cleanUrl}/#common/lib/${targetRepoId}/${encodeURIComponent(cleanPath)}`;

          return {
            success: true,
            message: 'Uploaded to Seafile successfully',
            repoId: targetRepoId,
            folder: cleanFolder,
            fileName: finalName,
            filePath: `/${cleanPath}`,
            viewUrl
          };
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            throw directErr;
          }
        }
      }

      // Fallback to local Node.js proxy
      const proxyForm = new FormData();
      proxyForm.append('file', fileBlob, finalName);
      if (targetRepoId) proxyForm.append('repoId', targetRepoId);
      if (cleanFolder) proxyForm.append('folder', cleanFolder);
      proxyForm.append('fileName', finalName);

      const proxyRes = await fetch(SeafileApi.apiUrl('/api/seafile/upload'), {
        method: 'POST',
        body: proxyForm
      });
      const ct = proxyRes.headers && proxyRes.headers.get ? (proxyRes.headers.get('content-type') || '') : '';
      if (!ct.includes('application/json')) {
        throw new Error(activeToken
          ? 'Upload to Seafile failed and local server proxy is unavailable.'
          : 'Seafile login is required for library uploads (or use a Direct Link without login).');
      }
      const proxyData = await proxyRes.json();
      if (!proxyRes.ok) {
        throw new Error(proxyData.error || 'Upload to Seafile failed');
      }
      return proxyData;
    }

    /**
     * List files in a Seafile library directory directly, with proxy fallback.
     * Returns empty list cleanly if user chose not to log in to Seafile.
     */
    static async getFiles(repoId, folder) {
      const { serverUrl: cleanUrl, token: activeToken, settings } = SeafileApi._getAuthContext();
      const targetRepoId = repoId || settings.repoId;
      const cleanDir = SeafileApi._normalizeFolder(folder || settings.folder || '/');

      if (cleanUrl && activeToken) {
        if (!targetRepoId) {
          return { files: [], warning: 'No library selected in settings.' };
        }
        try {
          const url = `${cleanUrl}/api2/repos/${targetRepoId}/dir/?p=${encodeURIComponent(cleanDir)}`;
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${activeToken}`,
              'Accept': 'application/json'
            }
          });
          if (!res.ok) {
            const msg = await SeafileApi._parseErrorResponse(res, 'Failed to list files');
            throw new Error(msg);
          }
          const items = await res.json();
          const baseFolder = cleanDir === '/' ? '' : cleanDir.replace(/\/+$/, '');
          const files = (Array.isArray(items) ? items : [])
            .filter(item => item.type === 'file')
            .map(item => ({
              name: item.name,
              size: item.size,
              mtime: item.mtime,
              isPdf: item.name.toLowerCase().endsWith('.pdf'),
              isImage: /\.(jpe?g|png|webp)$/i.test(item.name),
              fullPath: `${baseFolder}/${item.name}`
            }))
            .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

          return { files, folder: cleanDir, repoId: targetRepoId };
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            throw directErr;
          }
        }
      }

      // Proxy fallback
      try {
        const params = new URLSearchParams();
        if (targetRepoId) params.append('repoId', targetRepoId);
        if (cleanDir) params.append('folder', cleanDir);
        return await SeafileApi._fetchProxyJson(`/api/seafile/files?${params.toString()}`);
      } catch (e) {
        if (!activeToken) {
          return { files: [], unauthenticated: true, warning: 'Seafile login not configured.' };
        }
        throw e;
      }
    }

    static async getFileUrl(repoId, filePath) {
      const { serverUrl: cleanUrl, token: activeToken, settings } = SeafileApi._getAuthContext();
      const targetRepoId = repoId || settings.repoId;
      const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;

      if (cleanUrl && activeToken && targetRepoId) {
        try {
          const url = `${cleanUrl}/api2/repos/${targetRepoId}/file/?p=${encodeURIComponent(cleanPath)}&reuse=1`;
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Token ${activeToken}`
            }
          });
          if (!res.ok) {
            const msg = await SeafileApi._parseErrorResponse(res, 'Failed to get file URL');
            throw new Error(msg);
          }
          const text = await res.text();
          const rawFileUrl = text.replace(/^"|"$/g, '').trim();
          return SeafileApi._sanitizeUploadUrl(rawFileUrl, cleanUrl);
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            throw directErr;
          }
        }
      }

      const params = new URLSearchParams({ repoId: targetRepoId || '', path: cleanPath });
      const data = await SeafileApi._fetchProxyJson(`/api/seafile/file-url?${params.toString()}`);
      return data.url;
    }

    // Seafile Public Share Link Generation (/api2/repos/:repo_id/file/shared-link/)
    static async createShareLink(repoId, filePath, options = {}) {
      const { serverUrl: cleanUrl, token: activeToken, settings } = SeafileApi._getAuthContext();
      const targetRepoId = repoId || settings.repoId;
      const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;

      if (cleanUrl && activeToken && targetRepoId) {
        try {
          const headers = {
            'Authorization': `Token ${activeToken}`,
            'Accept': 'application/json, text/plain, */*'
          };
          const url = `${cleanUrl}/api2/repos/${targetRepoId}/file/shared-link/?p=${encodeURIComponent(cleanPath)}`;

          // 1. Classic PUT /api2/repos/:repo_id/file/shared-link/
          try {
            const bodyParams = new URLSearchParams();
            if (options.password) bodyParams.append('password', options.password);
            if (options.expire) bodyParams.append('expire', options.expire);

            const putRes = await fetch(url, {
              method: 'PUT',
              headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: bodyParams.toString()
            });

            if (putRes.ok) {
              const loc = putRes.headers && putRes.headers.get ? putRes.headers.get('location') : null;
              if (loc) return { success: true, shareUrl: loc, repoId: targetRepoId, path: cleanPath };

              const text = await putRes.text();
              try {
                const json = JSON.parse(text);
                const shareUrl = json.link || json.shared_link || json.url;
                if (shareUrl) return { success: true, shareUrl, token: json.token, repoId: targetRepoId, path: cleanPath };
              } catch (e) {
                const cleanLink = text.replace(/^"|"$/g, '').trim();
                if (cleanLink.startsWith('http')) {
                  return { success: true, shareUrl: cleanLink, repoId: targetRepoId, path: cleanPath };
                }
              }
            }
          } catch (err) {
            if (SeafileApi._isNetworkError(err)) throw err;
          }

          // 2. GET existing shared link
          try {
            const getRes = await fetch(url, { method: 'GET', headers });
            if (getRes.ok) {
              const text = await getRes.text();
              try {
                const json = JSON.parse(text);
                const shareUrl = json.link || json.shared_link || json.url || (Array.isArray(json) && json[0]?.link);
                if (shareUrl) return { success: true, shareUrl, token: json.token, repoId: targetRepoId, path: cleanPath };
              } catch (e) {
                const cleanLink = text.replace(/^"|"$/g, '').trim();
                if (cleanLink.startsWith('http')) {
                  return { success: true, shareUrl: cleanLink, repoId: targetRepoId, path: cleanPath };
                }
              }
            }
          } catch (err) {
            if (SeafileApi._isNetworkError(err)) throw err;
          }

          // 3. v2.1 /api/v2.1/share-links/
          const v21Res = await fetch(`${cleanUrl}/api/v2.1/share-links/`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${activeToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              repo_id: targetRepoId,
              path: cleanPath,
              permissions: { can_edit: false, can_download: true }
            })
          });
          if (v21Res.ok) {
            const v21Data = await v21Res.json();
            const shareUrl = v21Data.link || v21Data.shared_link;
            if (shareUrl) return { success: true, shareUrl, token: v21Data.token, repoId: targetRepoId, path: cleanPath };
          }

          // 4. Web preview fallback URL
          return {
            success: true,
            shareUrl: `${cleanUrl}/#common/lib/${targetRepoId}${encodeURI(cleanPath)}`,
            repoId: targetRepoId,
            path: cleanPath,
            fallback: true
          };
        } catch (directErr) {
          if (!SeafileApi._isNetworkError(directErr)) {
            throw directErr;
          }
        }
      }

      return await SeafileApi._fetchProxyJson('/api/seafile/share-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: targetRepoId,
          path: cleanPath,
          password: options.password || undefined,
          expire: options.expire || undefined
        })
      });
    }

    // In-App Update Checker
    static async checkUpdates(simulate = false) {
      // 1. Try local server endpoint if available
      try {
        const url = SeafileApi.apiUrl(`/api/updates/check${simulate ? '?simulate=true' : ''}`);
        const res = await fetch(url);
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          if (data && typeof data === 'object') {
            return data;
          }
        }
      } catch (e) {
        console.warn('[SeafileApi] Local update endpoint unavailable, falling back to GitHub API:', e.message);
      }

      // 2. Direct GitHub public API fallback (works directly inside Android APK and offline PC)
      try {
        const ghRes = await fetch('https://api.github.com/repos/IAndrexI/notescanner/commits/main');
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          const shortSha = (ghData.sha || '').substring(0, 7);
          const commitMsg = ghData.commit?.message || 'Latest GitHub release';
          const localCommit = (typeof localStorage !== 'undefined' ? localStorage.getItem('notescan_last_seen_commit') : null) || 'latest';
          const hasUpdate = localCommit !== shortSha && localCommit !== 'latest';
          return {
            hasUpdate,
            hasGitUpdate: hasUpdate,
            localCommit,
            latestCommit: { sha: shortSha, message: commitMsg },
            currentVersion: '1.0.0',
            latestVersion: shortSha,
            apkUrl: 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk',
            apkDirectDownload: 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk'
          };
        }
      } catch (ghErr) {
        console.warn('[SeafileApi] GitHub public API fallback error:', ghErr.message);
      }

      return {
        hasUpdate: false,
        currentVersion: '1.0.0',
        apkUrl: 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk',
        apkDirectDownload: 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk',
        message: 'Could not reach server or GitHub'
      };
    }

    static getApkDownloadUrl() {
      return 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk';
    }

    static async getLocalSeafileInfo() {
      try {
        return await SeafileApi._fetchProxyJson('/api/local-seafile');
      } catch (e) {
        return { hasLocalSeafile: false, foundPaths: [] };
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.SeafileApi = SeafileApi;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeafileApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
