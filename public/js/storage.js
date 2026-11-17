/**
 * LocalStorage & IndexedDB Manager for NoteScan / RocketScan
 * Persists documents locally, manages the offline upload queue,
 * and stores Seafile settings and Direct Links in localStorage.
 */
const NOTESCAN_SETTINGS_KEY = 'notescan_settings';
const NOTESCAN_DESTINATION_URLS_KEY = 'notescan_destination_urls';
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
      saveCopyToGallery: true,
      filterDefault: 'magic',
      account: null,
      destinationUrls: [],
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

  static _deriveNameFromUrl(url, fallbackIndex = 1) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname) return parsed.hostname;
    } catch (e) {}
    return `Destination ${fallbackIndex}`;
  }

  static normalizeDestinationUrls(links) {
    if (!Array.isArray(links)) return [];
    const result = [];
    for (let i = 0; i < links.length; i++) {
      const item = links[i];
      if (!item || typeof item !== 'object') continue;
      const url = StorageManager.normalizeUrl(item.url);
      if (!url) continue;
      const name = (item.name !== undefined && item.name !== null && String(item.name).trim())
        ? String(item.name).trim()
        : StorageManager._deriveNameFromUrl(url, result.length + 1);
      const id = (item.id !== undefined && item.id !== null && String(item.id).trim())
        ? String(item.id).trim()
        : `dest_${Date.now()}_${i}`;
      result.push({ id, name, url });
    }
    return result;
  }

  static normalizeDirectLinks(links) {
    return StorageManager.normalizeDestinationUrls(links);
  }

  // -------------------------------------------------------------
  // Destination URLs Persistence (localStorage: notescan_destination_urls)
  // -------------------------------------------------------------
  static getDestinationUrls() {
    const store = getKeyValueStore();
    try {
      const rawDest = store.getItem(NOTESCAN_DESTINATION_URLS_KEY);
      if (rawDest) {
        const parsed = JSON.parse(rawDest);
        if (Array.isArray(parsed)) {
          return StorageManager.normalizeDestinationUrls(parsed);
        }
      }
      // Fallback: check legacy direct links key
      const rawLegacy = store.getItem(NOTESCAN_DIRECT_LINKS_KEY);
      if (rawLegacy) {
        const parsed = JSON.parse(rawLegacy);
        if (Array.isArray(parsed)) {
          return StorageManager.normalizeDestinationUrls(parsed);
        }
      }
      // Fallback: check inside settings if separate keys weren't populated
      const rawSettings = store.getItem(NOTESCAN_SETTINGS_KEY);
      if (rawSettings) {
        const parsedSettings = JSON.parse(rawSettings);
        const list = Array.isArray(parsedSettings?.destinationUrls)
          ? parsedSettings.destinationUrls
          : parsedSettings?.directLinks;
        if (Array.isArray(list)) {
          return StorageManager.normalizeDestinationUrls(list);
        }
      }
    } catch (e) {
      console.warn('[StorageManager] Failed to read destination URLs:', e.message);
    }
    return [];
  }

  static saveDestinationUrls(links) {
    const store = getKeyValueStore();
    const normalized = StorageManager.normalizeDestinationUrls(links);
    try {
      const serialized = JSON.stringify(normalized);
      store.setItem(NOTESCAN_DESTINATION_URLS_KEY, serialized);
      store.setItem(NOTESCAN_DIRECT_LINKS_KEY, serialized);
      // Keep notescan_settings in sync if present
      const rawSettings = store.getItem(NOTESCAN_SETTINGS_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) || {};
        delete parsed.presets;
        parsed.destinationUrls = normalized;
        parsed.directLinks = normalized;
        store.setItem(NOTESCAN_SETTINGS_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.warn('[StorageManager] Failed to save destination URLs:', e.message);
    }
    return normalized;
  }

  static addDestinationUrl(nameOrObj, url) {
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
      throw new Error('A valid Destination URL is required.');
    }

    const links = StorageManager.getDestinationUrls();
    const newEntry = {
      id: id ? String(id).trim() : `dest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: (name && String(name).trim()) || StorageManager._deriveNameFromUrl(cleanUrl, links.length + 1),
      url: cleanUrl
    };

    links.push(newEntry);
    StorageManager.saveDestinationUrls(links);
    return newEntry;
  }

  static removeDestinationUrl(idOrIndexOrUrl) {
    const links = StorageManager.getDestinationUrls();
    let updated;
    if (typeof idOrIndexOrUrl === 'number') {
      updated = links.filter((_, idx) => idx !== idOrIndexOrUrl);
    } else {
      const target = String(idOrIndexOrUrl || '').trim();
      updated = links.filter(item => item.id !== target && item.url !== target);
    }
    return StorageManager.saveDestinationUrls(updated);
  }

  static updateDestinationUrl(idOrIndex, updates = {}) {
    const links = StorageManager.getDestinationUrls();
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
    return StorageManager.saveDestinationUrls(links);
  }

  // Legacy Direct Links aliases (for backwards compatibility)
  static getDirectLinks() { return StorageManager.getDestinationUrls(); }
  static saveDirectLinks(links) { return StorageManager.saveDestinationUrls(links); }
  static addDirectLink(nameOrObj, url) { return StorageManager.addDestinationUrl(nameOrObj, url); }
  static removeDirectLink(idOrIndexOrUrl) { return StorageManager.removeDestinationUrl(idOrIndexOrUrl); }
  static updateDirectLink(idOrIndex, updates) { return StorageManager.updateDestinationUrl(idOrIndex, updates); }

  // Instance wrappers for Destination URLs & Direct Links
  getDestinationUrls() { return StorageManager.getDestinationUrls(); }
  saveDestinationUrls(links) { return StorageManager.saveDestinationUrls(links); }
  addDestinationUrl(nameOrObj, url) { return StorageManager.addDestinationUrl(nameOrObj, url); }
  removeDestinationUrl(idOrIndexOrUrl) { return StorageManager.removeDestinationUrl(idOrIndexOrUrl); }
  updateDestinationUrl(idOrIndex, updates) { return StorageManager.updateDestinationUrl(idOrIndex, updates); }

  getDirectLinks() { return StorageManager.getDestinationUrls(); }
  saveDirectLinks(links) { return StorageManager.saveDestinationUrls(links); }
  addDirectLink(nameOrObj, url) { return StorageManager.addDestinationUrl(nameOrObj, url); }
  removeDirectLink(idOrIndexOrUrl) { return StorageManager.removeDestinationUrl(idOrIndexOrUrl); }
  updateDirectLink(idOrIndex, updates) { return StorageManager.updateDestinationUrl(idOrIndex, updates); }

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
    delete merged.presets;

    merged.serverUrl = (merged.serverUrl || '').trim().replace(/\/+$/, '');
    merged.token = (merged.token || '').trim();
    merged.hasToken = Boolean(merged.token || stored.hasToken);
    const urls = StorageManager.getDestinationUrls();
    merged.destinationUrls = urls;
    merged.directLinks = urls;
    return merged;
  }

  static saveSettings(partial = {}) {
    const store = getKeyValueStore();
    const current = StorageManager.getSettings();
    const next = { ...current };
    delete next.presets;

    if (partial && typeof partial === 'object') {
      for (const [key, val] of Object.entries(partial)) {
        if (val === undefined || key === 'presets') continue;
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
        if (key === 'destinationUrls' || key === 'directLinks') {
          const savedUrls = StorageManager.saveDestinationUrls(val);
          next.destinationUrls = savedUrls;
          next.directLinks = savedUrls;
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
