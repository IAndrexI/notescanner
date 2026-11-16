/**
 * LocalStorage & IndexedDB Manager for RocketScan
 * Persists documents locally and manages the offline upload queue.
 */
class StorageManager {
  constructor() {
    this.dbName = 'rocketscan_db';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
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
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['documents'], 'readwrite');
      const store = tx.objectStore('documents');
      const req = store.put(doc);
      req.onsuccess = () => resolve(doc);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllDocuments() {
    if (!this.db) await this.init();
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
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['upload_queue'], 'readwrite');
      const store = tx.objectStore('upload_queue');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

window.StorageManager = StorageManager;
