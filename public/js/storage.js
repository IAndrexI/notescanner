/**
 * LocalStorage & IndexedDB Manager for NoteScan / RocketScan
 * Persists documents locally, manages the offline upload queue,
 * and stores Seafile settings and Direct Links in localStorage.
 */
const NOTESCAN_SETTINGS_KEY = 'notescan_settings';
const NOTESCAN_DIRECT_LINKS_KEY = 'notescan_direct_links';

// In-memory fallback when localStorage is unavailable (e.g. non-browser test runners)
const memoryStorageFallback = new Map();

function getKeyValueStore() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (e) {
    // Ignore SecurityError in restricted contexts
  }
  return {
    getItem: (k) => (memoryStorageFallback.has(k) ? memoryStorageFallback.get(k) : null),
    setItem: (k, v) => { memoryStorageFallback.set(k, String(v)); },
    removeItem: (k) => { memoryStorageFallback.delete(k); }
  };
}

class StorageManager {
  constructor() {
    this.dbName = 'rocketscan_db';
    this.dbVersion = 1;
    this.db = null;
  }

  // -------------------------------------------------------------
  // Default Settings & Normalization Helpers
  // -------------------------------------------------------------
  static getDefaultSettings() {
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

  static normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
      return trimmed;
    }
    return `https://${trimmed}`;
  }

  static normalizeDirectLinks(links) {
    if (!Array.isArray(links)) return [];
    const result = [];
    for (let i = 0; i < links.length; i++) {
      const item = links[i];
      if (!item || typeof item !== 'object') continue;
      const url = StorageManager.normalizeUrl(item.url);
      if (!url) continue;
      const name = (item.name !== undefined && item.name !== null && String(item.name).trim())
        ? String(item.name).trim()
        : `Direct Link ${result.length + 1}`;
      const id = (item.id !== undefined && item.id !== null && String(item.id).trim())
        ? String(item.id).trim()
        : `dl_${Date.now()}_${i}`;
      result.push({ id, name, url });
    }
    return result;
  }

  // -------------------------------------------------------------
  // Direct Links Persistence (localStorage: notescan_direct_links)
  // -------------------------------------------------------------
  static getDirectLinks() {
    const store = getKeyValueStore();
    try {
      const raw = store.getItem(NOTESCAN_DIRECT_LINKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return StorageManager.normalizeDirectLinks(parsed);
        }
      }
      // Fallback: check inside settings if key wasn't populated separately
      const rawSettings = store.getItem(NOTESCAN_SETTINGS_KEY);
      if (rawSettings) {
        const parsedSettings = JSON.parse(rawSettings);
        if (parsedSettings && Array.isArray(parsedSettings.directLinks)) {
          return StorageManager.normalizeDirectLinks(parsedSettings.directLinks);
        }
      }
    } catch (e) {
      console.warn('[StorageManager] Failed to read direct links:', e.message);
    }
    return [];
  }

  static saveDirectLinks(links) {
    const store = getKeyValueStore();
    const normalized = StorageManager.normalizeDirectLinks(links);
    try {
      store.setItem(NOTESCAN_DIRECT_LINKS_KEY, JSON.stringify(normalized));
      // Keep notescan_settings in sync if present
      const rawSettings = store.getItem(NOTESCAN_SETTINGS_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) || {};
        parsed.directLinks = normalized;
        store.setItem(NOTESCAN_SETTINGS_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.warn('[StorageManager] Failed to save direct links:', e.message);
    }
    return normalized;
  }

  static addDirectLink(nameOrObj, url) {
    let name = '';
    let rawUrl = '';
    let id = '';

    if (nameOrObj && typeof nameOrObj === 'object') {
      name = nameOrObj.name || '';
      rawUrl = nameOrObj.url || '';
      id = nameOrObj.id || '';
    } else {
      name = nameOrObj || '';
      rawUrl = url || '';
    }

    const cleanUrl = StorageManager.normalizeUrl(rawUrl);
    if (!cleanUrl) {
      throw new Error('A valid Direct Link URL is required.');
    }

    const links = StorageManager.getDirectLinks();
    const newEntry = {
      id: id ? String(id).trim() : `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: (name && String(name).trim()) || cleanUrl,
      url: cleanUrl
    };

    links.push(newEntry);
    StorageManager.saveDirectLinks(links);
    return newEntry;
  }

  static removeDirectLink(idOrIndexOrUrl) {
    const links = StorageManager.getDirectLinks();
    let updated;
    if (typeof idOrIndexOrUrl === 'number') {
      updated = links.filter((_, idx) => idx !== idOrIndexOrUrl);
    } else {
      const target = String(idOrIndexOrUrl || '').trim();
      updated = links.filter(item => item.id !== target && item.url !== target);
    }
    return StorageManager.saveDirectLinks(updated);
  }

  static updateDirectLink(idOrIndex, updates = {}) {
    const links = StorageManager.getDirectLinks();
    const idx = typeof idOrIndex === 'number'
      ? idOrIndex
      : links.findIndex(item => item.id === String(idOrIndex));
    if (idx >= 0 && idx < links.length) {
      links[idx] = {
        ...links[idx],
        ...updates,
        id: links[idx].id
      };
    }
    return StorageManager.saveDirectLinks(links);
  }

  // Instance wrappers for Direct Links
  getDirectLinks() { return StorageManager.getDirectLinks(); }
  saveDirectLinks(links) { return StorageManager.saveDirectLinks(links); }
  addDirectLink(nameOrObj, url) { return StorageManager.addDirectLink(nameOrObj, url); }
  removeDirectLink(idOrIndexOrUrl) { return StorageManager.removeDirectLink(idOrIndexOrUrl); }
  updateDirectLink(idOrIndex, updates) { return StorageManager.updateDirectLink(idOrIndex, updates); }

  // -------------------------------------------------------------
  // Settings / Seafile Configuration Persistence
  // -------------------------------------------------------------
  static getSettings() {
    const store = getKeyValueStore();
    const defaults = StorageManager.getDefaultSettings();
    let stored = {};

    try {
      const raw = store.getItem(NOTESCAN_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          stored = parsed;
        }
      }
    } catch (e) {
      console.warn('[StorageManager] Failed to read settings:', e.message);
    }

    const merged = {
      ...defaults,
      ...stored
    };

    merged.serverUrl = (merged.serverUrl || '').trim().replace(/\/+$/, '');
    merged.token = (merged.token || '').trim();
    merged.hasToken = Boolean(merged.token || stored.hasToken);
    merged.directLinks = StorageManager.getDirectLinks();
    return merged;
  }

  static saveSettings(partial = {}) {
    const store = getKeyValueStore();
    const current = StorageManager.getSettings();
    const next = { ...current };

    if (partial && typeof partial === 'object') {
      for (const [key, val] of Object.entries(partial)) {
        if (val === undefined) continue;
        if (key === 'token') {
          // Only overwrite token if non-empty or explicitly clearing
          if (val === null || partial.clearToken === true) {
            next.token = '';
            next.hasToken = false;
          } else if (typeof val === 'string' && val.trim() !== '') {
            next.token = val.trim();
            next.hasToken = true;
          }
          continue;
        }
        if (key === 'clearToken') continue;
        if (key === 'directLinks') {
          next.directLinks = StorageManager.saveDirectLinks(val);
          continue;
        }
        if (key === 'serverUrl' && typeof val === 'string') {
          next.serverUrl = val.trim().replace(/\/+$/, '');
          continue;
        }
        next[key] = val;
      }
    }

    if (partial.clearToken === true || partial.token === null) {
      next.token = '';
      next.hasToken = false;
    } else {
      next.hasToken = Boolean(next.token || next.hasToken);
    }

    try {
      store.setItem(NOTESCAN_SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[StorageManager] Failed to save settings:', e.message);
    }

    return next;
  }

  static clearSeafileAuth() {
    return StorageManager.saveSettings({
      token: null,
      clearToken: true,
      account: null
    });
  }

  // Instance wrappers for Settings
  getSettings() { return StorageManager.getSettings(); }
  saveSettings(partial) { return StorageManager.saveSettings(partial); }
  clearSeafileAuth() { return StorageManager.clearSeafileAuth(); }

  // -------------------------------------------------------------
  // IndexedDB Document & Offline Queue Storage
  // -------------------------------------------------------------
  async init() {
    if (typeof indexedDB === 'undefined') {
      return null;
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('upload_queue')) {
          const queueStore = db.createObjectStore('upload_queue', { keyPath: 'id' });
          queueStore.createIndex('status', 'status', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB open error:', e);
        reject(e.target.error);
      };
    });
  }

  async saveDocument(doc) {
    if (!this.db) await this.init();
    if (!this.db) return doc;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['documents'], 'readwrite');
      const store = tx.objectStore('documents');
      const req = store.put(doc);
      req.onsuccess = () => resolve(doc);
      req.onerror = () => reject(req.error);
    });
  }

  async getDocument(id) {
    if (!this.db) await this.init();
    if (!this.db) return null;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['documents'], 'readonly');
      const store = tx.objectStore('documents');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllDocuments() {
    if (!this.db) await this.init();
    if (!this.db) return [];
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['documents'], 'readonly');
      const store = tx.objectStore('documents');
      const index = store.index('createdAt');
      const req = index.getAll();
      req.onsuccess = () => resolve(req.result.reverse());
      req.onerror = () => reject(req.error);
    });
  }

  async deleteDocument(id) {
    if (!this.db) await this.init();
    if (!this.db) return false;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['documents'], 'readwrite');
      const store = tx.objectStore('documents');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // Queue item for background upload
  async enqueueUpload(queueItem) {
    if (!this.db) await this.init();
    if (!this.db) return false;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['upload_queue'], 'readwrite');
      const store = tx.objectStore('upload_queue');
      const req = store.put({
        ...queueItem,
        status: 'pending',
        queuedAt: Date.now()
      });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async getPendingUploads() {
    if (!this.db) await this.init();
    if (!this.db) return [];
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['upload_queue'], 'readonly');
      const store = tx.objectStore('upload_queue');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.filter(i => i.status === 'pending'));
      req.onerror = () => reject(req.error);
    });
  }

  async removeQueueItem(id) {
    if (!this.db) await this.init();
    if (!this.db) return false;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['upload_queue'], 'readwrite');
      const store = tx.objectStore('upload_queue');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
