/**
 * NoteScan In-App Updater (public/js/updater.js)
 * Checks for new releases on startup, shows an in-app modal / banner,
 * enables 1-tap direct download of NoteScan.apk, and 1-click server update from GitHub.
 */
class NoteScanUpdater {
  static init() {
    // Check for updates on startup with a brief delay so camera and UI initialize smoothly
    window.addEventListener('load', () => {
      setTimeout(() => {
        NoteScanUpdater.check({ manual: false }).catch(err => {
          console.warn('[Updater] Startup check notice:', err.message);
        });
      }, 1500);
    });
  }

  /**
   * Check for GitHub releases updates and commits
   * @param {Object} options
   * @param {boolean} options.manual - True if triggered by user click (shows up-to-date toast)
   * @param {boolean} options.simulate - True to simulate an available update for testing
   */
  static async check(options = {}) {
    const { manual = false, simulate = false } = options;

    try {
      if (manual && window.showToast) {
        window.showToast('Checking GitHub for updates...', 'info');
      }

      const updateData = await SeafileApi.checkUpdates(simulate);

      // Update version display in Settings if elements exist
      const gitCommitElem = document.getElementById('current-git-commit');
      if (gitCommitElem && updateData.localCommit) {
        gitCommitElem.textContent = `${updateData.localCommit}`;
      }

      if (updateData.hasUpdate || updateData.hasGitUpdate) {
        NoteScanUpdater.showUpdatePrompt(updateData);
        NoteScanUpdater.showBadgeInHeader(updateData);
      } else if (manual) {
        if (window.showToast) {
          window.showToast(`✓ NoteScan is up to date (${updateData.localCommit || `v${updateData.currentVersion}`})!`, 'success');
        }
      }
      return updateData;
    } catch (err) {
      console.warn('[Updater] Check failed:', err);
      if (manual && window.showToast) {
        window.showToast(`Could not check for updates: ${err.message}`, 'error');
      }
      return { hasUpdate: false, error: err.message };
    }
  }

  /**
   * Helper to detect if running inside Android APK / Capacitor native wrapper
   */
  static isNative() {
    return Boolean(
      (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
      (window.location.origin.includes('localhost') && /Android|iPhone|iPad/i.test(navigator.userAgent)) ||
      window.location.origin.startsWith('capacitor:') ||
      window.location.origin.startsWith('file:')
    );
  }

  /**
   * Safely download the latest NoteScan.apk from GitHub
   */
  static downloadApk() {
    if (window.showToast) {
      window.showToast('📥 Downloading latest NoteScan.apk...', 'success');
    }
    const apkUrl = 'https://github.com/IAndrexI/notescanner/raw/main/NoteScan.apk';
    const a = document.createElement('a');
    a.href = apkUrl;
    a.download = 'NoteScan.apk';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  }

  /**
   * Action handler for settings update button
   */
  static handleUpdateAction() {
    if (NoteScanUpdater.isNative()) {
      NoteScanUpdater.downloadApk();
    } else {
      NoteScanUpdater.applyServerUpdate();
    }
  }

  /**
   * Apply 1-Click Server Update directly from GitHub
   */
  static async applyServerUpdate() {
    if (NoteScanUpdater.isNative()) {
      NoteScanUpdater.downloadApk();
      return;
    }

    if (window.showLoading) {
      window.showLoading('Pulling latest update from GitHub and restarting...');
    }

    try {
      const targetUrl = SeafileApi.apiUrl ? SeafileApi.apiUrl('/api/updates/apply') : '/api/updates/apply';
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error('Server returned HTML or non-JSON response. If running on Android, please download NoteScan.apk.');
      }

      if (!res.ok) {
        throw new Error(data.error || 'Server update failed');
      }

      if (window.showToast) {
        window.showToast('✓ Update applied! Restarting NoteScan in 3 seconds...', 'success');
      }

      // Clear Service Worker cache before reloading
      if ('serviceWorker' in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.update();
          if ('caches' in window) {
            const keys = await caches.keys();
            for (const k of keys) await caches.delete(k);
          }
        } catch (e) {}
      }

      setTimeout(() => {
        window.location.reload(true);
      }, 3500);

    } catch (err) {
      if (window.hideLoading) window.hideLoading();
      if (window.showToast) {
        window.showToast(`Update notice: ${err.message}`, 'error');
      }
    }
  }

  /**
   * Show in-app update banner / modal
   */
  static showUpdatePrompt(data) {
    const targetVersion = data.latestCommit?.sha || data.latestVersion || 'latest';
    const dismissedKey = `notescan_dismissed_update_${targetVersion}`;
    const dismissedTime = localStorage.getItem(dismissedKey);
    // If dismissed in the last 24 hours, skip automatic popup
    if (dismissedTime && (Date.now() - parseInt(dismissedTime, 10)) < 24 * 60 * 60 * 1000) {
      return;
    }

    // Remove existing update modal or banner if present
    const existing = document.getElementById('notescan-updater-modal');
    if (existing) existing.remove();

    const apkUrl = data.apkDirectDownload || SeafileApi.getApkDownloadUrl();
    const releaseTitle = data.releaseName || (data.latestCommit ? `GitHub Commit ${data.latestCommit.sha}` : `NoteScan v${data.latestVersion}`);
    const commitMsg = data.latestCommit?.message || data.releaseNotes || 'New features, bug fixes, and performance updates from GitHub.';
    const sanitizedNotes = commitMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

    const isNativeApp = NoteScanUpdater.isNative();
    const serverBtnStyle = isNativeApp ? 'style="display: none;"' : '';
    const apkBtnClass = isNativeApp ? 'btn-primary' : 'btn-secondary';
    const apkBtnSubtext = isNativeApp ? 'Tap to download and install latest update' : 'For Android standalone app';

    const modal = document.createElement('div');
    modal.id = 'notescan-updater-modal';
    modal.className = 'updater-backdrop';

    modal.innerHTML = `
      <div class="updater-dialog animate-fade-in">
        <div class="updater-header">
          <div class="updater-header-title">
            <span class="updater-sparkle">🚀</span>
            <div>
              <h3>Update Available</h3>
              <p class="updater-version-tag">${releaseTitle}</p>
            </div>
          </div>
          <button class="updater-close-btn" id="btn-updater-close" title="Dismiss">×</button>
        </div>

        <div class="updater-body">
          <div class="updater-version-pills">
            <span class="version-pill current">Installed: ${data.localCommit || `v${data.currentVersion}`}</span>
            <span class="version-arrow">➔</span>
            <span class="version-pill latest">GitHub: ${data.latestCommit?.sha || data.latestVersion}</span>
          </div>

          <div class="updater-release-box">
            <div class="updater-release-header">What's New on GitHub:</div>
            <div class="updater-release-content">${sanitizedNotes}</div>
          </div>

          <div class="updater-options-notice">
            Choose how you would like to apply this update:
          </div>
        </div>

        <div class="updater-actions">
          <!-- 1-Tap APK Download for Android users -->
          <a href="${apkUrl}" id="btn-updater-apk" class="btn ${apkBtnClass} updater-btn-apk" download="NoteScan.apk">
            <span>📲</span>
            <div class="btn-text-group">
              <span class="btn-primary-text">Download Updated NoteScan.apk</span>
              <span class="btn-subtext">${apkBtnSubtext}</span>
            </div>
          </a>

          <!-- 1-Click Server Update (Pulls from GitHub and restarts) -->
          <button id="btn-updater-server-apply" class="btn btn-primary updater-btn-server" ${serverBtnStyle}>
            <span>🚀</span>
            <div class="btn-text-group">
              <span class="btn-primary-text">1-Click Update Server from GitHub</span>
              <span class="btn-subtext">Pulls latest code & restarts NoteScan service</span>
            </div>
          </button>

          <div class="updater-secondary-row">
            <button id="btn-updater-reload" class="btn btn-ghost updater-btn-reload">
              <span>🔄 Web Reload</span>
            </button>
            <button id="btn-updater-later" class="btn btn-ghost updater-btn-later">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('btn-updater-close')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(targetVersion);
    });

    document.getElementById('btn-updater-later')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(targetVersion);
    });

    document.getElementById('btn-updater-server-apply')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(targetVersion);
      NoteScanUpdater.applyServerUpdate();
    });

    document.getElementById('btn-updater-apk')?.addEventListener('click', () => {
      if (window.showToast) {
        window.showToast('📥 Downloading NoteScan.apk...', 'success');
      }
      setTimeout(() => {
        NoteScanUpdater.dismiss(targetVersion);
      }, 2000);
    });

    document.getElementById('btn-updater-reload')?.addEventListener('click', async () => {
      if (window.showToast) {
        window.showToast('Clearing cache and reloading...', 'info');
      }
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let reg of registrations) await reg.update();
          if ('caches' in window) {
            const keys = await caches.keys();
            for (let key of keys) await caches.delete(key);
          }
        } catch (e) {}
      }
      window.location.reload(true);
    });
  }

  static dismiss(version) {
    const modal = document.getElementById('notescan-updater-modal');
    if (modal) {
      modal.classList.add('fade-out');
      setTimeout(() => modal.remove(), 250);
    }
    if (version) {
      localStorage.setItem(`notescan_dismissed_update_${version}`, Date.now().toString());
    }
  }

  static showBadgeInHeader(data) {
    const headerNav = document.querySelector('.header-nav');
    if (!headerNav || document.getElementById('nav-update-pill')) return;

    const pill = document.createElement('button');
    pill.id = 'nav-update-pill';
    pill.className = 'nav-tab nav-update-badge animate-pulse';
    pill.innerHTML = `
      <span class="tab-icon">🚀</span>
      <span class="tab-label">Update</span>
    `;
    pill.title = 'New version or commit available from GitHub';
    pill.addEventListener('click', () => {
      NoteScanUpdater.showUpdatePrompt(data);
    });

    headerNav.insertBefore(pill, headerNav.firstChild);
  }
}

window.NoteScanUpdater = NoteScanUpdater;
NoteScanUpdater.init();
