/**
 * NoteScan In-App Updater (public/js/updater.js)
 * Checks for new releases on startup and lets the user update with one tap.
 */
class NoteScanUpdater {
  static APK_FALLBACK_URL = 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk';
  static DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
  static _initialized = false;
  static _latestData = null;
  static _escHandler = null;

  static init() {
    if (NoteScanUpdater._initialized) return;
    NoteScanUpdater._initialized = true;

    const scheduleCheck = () => {
      setTimeout(() => {
        NoteScanUpdater.check({ manual: false }).catch((err) => {
          console.warn('[Updater] Startup check notice:', err.message);
        });
      }, 1500);
    };

    if (document.readyState === 'complete') {
      scheduleCheck();
    } else {
      window.addEventListener('load', scheduleCheck, { once: true });
    }
  }

  /**
   * Check for available updates.
   * @param {Object} options
   * @param {boolean} options.manual - True when triggered by the user
   * @param {boolean} options.simulate - True to simulate an available update
   */
  static async check(options = {}) {
    const { manual = false, simulate = false } = options;

    try {
      if (manual) {
        NoteScanUpdater.notify('Checking for updates...', 'info');
      }

      if (!window.SeafileApi || typeof window.SeafileApi.checkUpdates !== 'function') {
        throw new Error('Update service is unavailable');
      }

      const updateData = await window.SeafileApi.checkUpdates(simulate);
      NoteScanUpdater._latestData = updateData;

      const gitCommitElem = document.getElementById('current-git-commit');
      if (gitCommitElem && updateData.localCommit) {
        gitCommitElem.textContent = updateData.localCommit;
      }

      const versionElem = document.getElementById('settings-app-version');
      if (versionElem && updateData.currentVersion) {
        versionElem.textContent = updateData.currentVersion;
      }

      if (updateData.hasUpdate || updateData.hasGitUpdate) {
        NoteScanUpdater.showUpdatePrompt(updateData, { force: manual });
        NoteScanUpdater.showBadgeInHeader(updateData);
      } else if (manual) {
        const currentLabel = NoteScanUpdater.formatCurrentLabel(updateData);
        NoteScanUpdater.notify(`NoteScan is up to date (${currentLabel}).`, 'success');
      }

      return updateData;
    } catch (err) {
      console.warn('[Updater] Check failed:', err);
      if (manual) {
        NoteScanUpdater.notify(`Could not check for updates: ${err.message}`, 'error');
      }
      return { hasUpdate: false, error: err.message };
    }
  }

  static notify(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    }
  }

  static escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static formatCurrentLabel(data) {
    if (data?.localCommit && data.localCommit !== 'unknown' && data.localCommit !== 'latest') {
      return `commit ${data.localCommit}`;
    }
    return `v${String(data?.currentVersion || '1.0.0').replace(/^v/i, '')}`;
  }

  static formatTargetTitle(data) {
    const currentVer = String(data?.currentVersion || '').replace(/^v/i, '').trim();
    const latestVer = String(data?.latestVersion || '').replace(/^v/i, '').trim();
    const sha = data?.latestCommit?.sha ? String(data.latestCommit.sha).trim() : '';

    if (latestVer && latestVer !== currentVer && latestVer !== sha) {
      return `NoteScan v${latestVer}`;
    }
    if (sha) {
      return `commit ${sha}`;
    }
    if (latestVer) {
      return `NoteScan v${latestVer}`;
    }
    return 'NoteScan';
  }

  static getTargetKey(data) {
    return data?.latestCommit?.sha || data?.latestVersion || 'latest';
  }

  /**
   * Detect if running inside a native wrapper (Capacitor / file / localhost mobile).
   */
  static isNative() {
    const origin = window.location?.origin || '';
    const ua = navigator.userAgent || '';
    return Boolean(
      window.Capacitor?.isNativePlatform?.() ||
      (origin.includes('localhost') && /Android|iPhone|iPad/i.test(ua)) ||
      origin.startsWith('capacitor:') ||
      origin.startsWith('file:')
    );
  }

  /**
   * Detect Android devices (native app or Android mobile browser).
   */
  static isAndroid() {
    const platform = window.Capacitor?.getPlatform?.();
    if (platform === 'android') return true;
    if (platform === 'ios') return false;
    return /Android/i.test(navigator.userAgent || '');
  }

  static getApkUrl(data = null) {
    const candidate = data?.apkUrl || data?.apkDirectDownload;
    if (candidate && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    if (!NoteScanUpdater.isNative() && candidate) {
      return candidate;
    }
    if (window.SeafileApi && typeof window.SeafileApi.getApkDownloadUrl === 'function') {
      return window.SeafileApi.getApkDownloadUrl();
    }
    return NoteScanUpdater.APK_FALLBACK_URL;
  }

  /**
   * Download the latest NoteScan APK.
   */
  static downloadApk(apkUrl = null) {
    const url = apkUrl || NoteScanUpdater.getApkUrl(NoteScanUpdater._latestData);
    NoteScanUpdater.notify('Downloading NoteScan.apk...', 'success');

    const a = document.createElement('a');
    a.href = url;
    a.download = 'NoteScan.apk';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  }

  /**
   * Primary update action: download APK on Android/mobile, or update & reload on web.
   */
  static handleUpdateAction(data = null) {
    return NoteScanUpdater.updateNow(data || NoteScanUpdater._latestData);
  }

  static updateNow(data = null) {
    const info = data || NoteScanUpdater._latestData;
    if (NoteScanUpdater.isAndroid()) {
      NoteScanUpdater.downloadApk(NoteScanUpdater.getApkUrl(info));
      return;
    }
    return NoteScanUpdater.applyWebUpdate();
  }

  static async clearCachesAndReload() {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.update();
        }
      } catch (e) {}
    }
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      } catch (e) {}
    }
    window.location.reload();
  }

  /**
   * Update and reload the web app. If a local backend supports /api/updates/apply,
   * apply it first; otherwise clear caches and reload cleanly.
   */
  static async applyWebUpdate() {
    if (NoteScanUpdater.isAndroid()) {
      NoteScanUpdater.downloadApk(NoteScanUpdater.getApkUrl(NoteScanUpdater._latestData));
      return;
    }

    if (typeof window.showLoading === 'function') {
      window.showLoading('Updating NoteScan...');
    }

    try {
      if (!NoteScanUpdater.isNative()) {
        const targetUrl = window.SeafileApi?.apiUrl
          ? window.SeafileApi.apiUrl('/api/updates/apply')
          : '/api/updates/apply';

        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });

          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const payload = await res.json();
            if (res.ok && payload?.success) {
              NoteScanUpdater.notify('Update applied. Reloading NoteScan...', 'success');
              setTimeout(() => {
                NoteScanUpdater.clearCachesAndReload();
              }, 3000);
              return;
            }
            // If server returned a 5xx error during git update, surface it cleanly
            if (res.status >= 500 && payload?.error) {
              throw new Error(payload.error);
            }
          }
        } catch (fetchErr) {
          // If it's a 5xx update error we threw above, rethrow; otherwise fall back to cache-busting reload
          if (fetchErr && fetchErr.message && fetchErr.message.startsWith('Update failed:')) {
            throw fetchErr;
          }
        }
      }

      NoteScanUpdater.notify('Reloading to latest version...', 'info');
      await NoteScanUpdater.clearCachesAndReload();
    } catch (err) {
      if (typeof window.hideLoading === 'function') {
        window.hideLoading();
      }
      NoteScanUpdater.notify(`Update notice: ${err.message}`, 'error');
    }
  }

  // Backwards-compatible alias
  static applyServerUpdate() {
    return NoteScanUpdater.applyWebUpdate();
  }

  /**
   * Show a clean, simple update dialog.
   */
  static showUpdatePrompt(data, options = {}) {
    const { force = false } = options;
    const targetKey = NoteScanUpdater.getTargetKey(data);

    if (!force) {
      const dismissedTime = localStorage.getItem(`notescan_dismissed_update_${targetKey}`);
      if (dismissedTime && (Date.now() - parseInt(dismissedTime, 10)) < NoteScanUpdater.DISMISS_TTL_MS) {
        return;
      }
    }

    const existing = document.getElementById('notescan-updater-modal');
    if (existing) existing.remove();
    if (NoteScanUpdater._escHandler) {
      document.removeEventListener('keydown', NoteScanUpdater._escHandler);
      NoteScanUpdater._escHandler = null;
    }

    const titleText = `Update Available: ${NoteScanUpdater.formatTargetTitle(data)}`;
    const currentLabel = NoteScanUpdater.formatCurrentLabel(data);
    const targetLabel = NoteScanUpdater.formatTargetTitle(data);
    const rawNotes = data?.latestCommit?.message || data?.releaseNotes || '';
    const sanitizedNotes = NoteScanUpdater.escapeHtml(rawNotes).replace(/\n/g, '<br>');

    const modal = document.createElement('div');
    modal.id = 'notescan-updater-modal';
    modal.className = 'updater-backdrop';

    modal.innerHTML = `
      <div class="updater-dialog animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="updater-dialog-title">
        <div class="updater-header">
          <div class="updater-header-title">
            <div>
              <h3 id="updater-dialog-title">${NoteScanUpdater.escapeHtml(titleText)}</h3>
            </div>
          </div>
          <button type="button" class="updater-close-btn" id="btn-updater-close" title="Dismiss" aria-label="Dismiss">&times;</button>
        </div>

        <div class="updater-body">
          <div class="updater-version-pills">
            <span class="version-pill current">Current: ${NoteScanUpdater.escapeHtml(currentLabel)}</span>
            <span class="version-arrow">to</span>
            <span class="version-pill latest">New: ${NoteScanUpdater.escapeHtml(targetLabel)}</span>
          </div>
          ${sanitizedNotes ? `
            <div class="updater-release-box">
              <div class="updater-release-header">Release Notes</div>
              <div class="updater-release-content">${sanitizedNotes}</div>
            </div>
          ` : ''}
        </div>

        <div class="updater-actions">
          <button type="button" id="btn-updater-update" class="btn btn-primary" style="width: 100%; justify-content: center;">
            Update Now
          </button>
          <button type="button" id="btn-updater-later" class="btn btn-ghost updater-btn-later" style="width: 100%;">
            Dismiss
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-updater-close')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(targetKey);
    });

    document.getElementById('btn-updater-later')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(targetKey);
    });

    document.getElementById('btn-updater-update')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(targetKey);
      NoteScanUpdater.updateNow(data);
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        NoteScanUpdater.dismiss(targetKey);
      }
    });

    NoteScanUpdater._escHandler = (e) => {
      if (e.key === 'Escape') {
        NoteScanUpdater.dismiss(targetKey);
      }
    };
    document.addEventListener('keydown', NoteScanUpdater._escHandler);
  }

  static dismiss(version) {
    if (NoteScanUpdater._escHandler) {
      document.removeEventListener('keydown', NoteScanUpdater._escHandler);
      NoteScanUpdater._escHandler = null;
    }

    const modal = document.getElementById('notescan-updater-modal');
    if (modal) {
      modal.classList.add('fade-out');
      setTimeout(() => modal.remove(), 200);
    }

    if (version) {
      localStorage.setItem(`notescan_dismissed_update_${version}`, Date.now().toString());
    }
  }

  static showBadgeInHeader(data) {
    const headerNav = document.querySelector('.header-nav');
    if (!headerNav || document.getElementById('nav-update-pill')) return;

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = 'nav-update-pill';
    pill.className = 'nav-tab nav-update-badge';
    pill.innerHTML = `
      <span class="pulse-dot"></span>
      <span class="tab-label">Update</span>
    `;
    pill.title = `Update Available: ${NoteScanUpdater.formatTargetTitle(data)}`;
    pill.addEventListener('click', () => {
      NoteScanUpdater.showUpdatePrompt(data, { force: true });
    });

    headerNav.insertBefore(pill, headerNav.firstChild);
  }
}

window.NoteScanUpdater = NoteScanUpdater;
NoteScanUpdater.init();
