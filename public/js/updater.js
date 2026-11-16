/**
 * NoteScan In-App Updater (public/js/updater.js)
 * Checks for new releases on startup, shows an in-app modal / banner,
 * and enables 1-tap direct download of NoteScan.apk or web reload.
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
   * Check for GitHub releases updates
   * @param {Object} options
   * @param {boolean} options.manual - True if triggered by user click (shows up-to-date toast)
   * @param {boolean} options.simulate - True to simulate an available update for testing
   */
  static async check(options = {}) {
    const { manual = false, simulate = false } = options;

    try {
      if (manual && window.showToast) {
        window.showToast('Checking for updates...', 'info');
      }

      const updateData = await SeafileApi.checkUpdates(simulate);

      if (updateData.hasUpdate) {
        NoteScanUpdater.showUpdatePrompt(updateData);
        NoteScanUpdater.showBadgeInHeader(updateData);
      } else if (manual) {
        if (window.showToast) {
          window.showToast(`✓ NoteScan is up to date (v${updateData.currentVersion || '1.0.0'})!`, 'success');
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
   * Show in-app update banner / modal
   */
  static showUpdatePrompt(data) {
    const dismissedKey = `notescan_dismissed_update_${data.latestVersion}`;
    const dismissedTime = localStorage.getItem(dismissedKey);
    // If dismissed in the last 24 hours and not manually checking, skip
    if (dismissedTime && (Date.now() - parseInt(dismissedTime, 10)) < 24 * 60 * 60 * 1000) {
      return;
    }

    // Remove existing update modal or banner if present
    const existing = document.getElementById('notescan-updater-modal');
    if (existing) existing.remove();

    const apkUrl = data.apkDirectDownload || SeafileApi.getApkDownloadUrl();
    const releaseTitle = data.releaseName || `NoteScan v${data.latestVersion}`;
    const releaseNotes = (data.releaseNotes || 'Bug fixes, speed improvements, and Seafile enhancements.')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

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
            <span class="version-pill current">Current: v${data.currentVersion}</span>
            <span class="version-arrow">➔</span>
            <span class="version-pill latest">New: v${data.latestVersion}</span>
          </div>

          <div class="updater-release-box">
            <div class="updater-release-header">What's New:</div>
            <div class="updater-release-content">${releaseNotes}</div>
          </div>

          <div class="updater-options-notice">
            Choose how you'd like to apply this update:
          </div>
        </div>

        <div class="updater-actions">
          <a href="${apkUrl}" id="btn-updater-apk" class="btn btn-primary updater-btn-apk" download="NoteScan.apk">
            <span>📲</span>
            <div class="btn-text-group">
              <span class="btn-primary-text">1-Tap Download NoteScan.apk</span>
              <span class="btn-subtext">Direct install for Android</span>
            </div>
          </a>

          <div class="updater-secondary-row">
            <button id="btn-updater-reload" class="btn btn-secondary updater-btn-reload">
              <span>🔄 Web Reload</span>
            </button>
            <button id="btn-updater-later" class="btn btn-ghost updater-btn-later">
              Later
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('btn-updater-close')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(data.latestVersion);
    });

    document.getElementById('btn-updater-later')?.addEventListener('click', () => {
      NoteScanUpdater.dismiss(data.latestVersion);
    });

    document.getElementById('btn-updater-apk')?.addEventListener('click', () => {
      if (window.showToast) {
        window.showToast('📥 Downloading NoteScan.apk...', 'success');
      }
      setTimeout(() => {
        NoteScanUpdater.dismiss(data.latestVersion);
      }, 2000);
    });

    document.getElementById('btn-updater-reload')?.addEventListener('click', async () => {
      if (window.showToast) {
        window.showToast('Clearing cache and reloading...', 'info');
      }
      // Clear Service Worker cache if present
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let reg of registrations) {
            await reg.update();
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            for (let key of keys) {
              await caches.delete(key);
            }
          }
        } catch (e) {}
      }
      // Force page reload from server
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
    const headerBrand = document.querySelector('.header-brand');
    if (!headerBrand) return;

    let badge = document.getElementById('updater-header-pill');
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'updater-header-pill';
      badge.className = 'updater-header-pill';
      badge.title = `Click to update to v${data.latestVersion}`;
      badge.onclick = () => NoteScanUpdater.showUpdatePrompt(data);
      headerBrand.appendChild(badge);
    }
    badge.innerHTML = `<span class="pulse-dot"></span> v${data.latestVersion} Available`;
  }
}

// Auto-initialize
NoteScanUpdater.init();
window.NoteScanUpdater = NoteScanUpdater;
