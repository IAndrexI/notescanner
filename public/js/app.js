/**
 * NoteScan Main Application Controller
 */

const DESTINATION_URLS_STORAGE_KEY = 'notescan_destination_urls';
const LEGACY_DIRECT_LINKS_KEY = 'notescan_direct_links';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Application State
const state = {
  view: 'scanner', // 'scanner' | 'crop' | 'filter' | 'gallery' | 'settings'
  capturedImage: null, // Image element of current raw capture
  corners: null, // [TL, TR, BR, BL] coordinates
  activeCornerIndex: null,
  activePageCanvas: null, // Flattened canvas of current page
  activePageSavedLocally: false,
  activeFilter: 'magic', // 'magic' | 'bw' | 'grayscale' | 'original'
  pages: [], // Array of { id, originalImage, corners, canvas, filter, rotation }
  documentTitle: '',
  seafileConfig: {
    serverUrl: 'https://seafile.protutech.vip',
    hasToken: false,
    repoId: '',
    repoName: '',
    folder: '/',
    autoUpload: true,
    saveCopyToGallery: true
  },
  destinationUrls: [], // Array of { id, name, url } - ONLY user-added destination URLs
  availableRepos: [],
  networkInfo: null,
  seafileFiles: []
};

// Subsystem instances
const vision = new VisionEngine();
const storage = new StorageManager();
let cameraScanner = null;
let handwritingConverter = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  await storage.init();
  initUI();
  await loadConfigAndNetwork();
  initCamera();
  loadSeafileGallery();
});

async function loadDestinationUrls(configLinks = null) {
  let links = [];
  try {
    if (typeof storage.getDestinationUrls === 'function') {
      const storedLinks = await storage.getDestinationUrls();
      if (Array.isArray(storedLinks) && storedLinks.length > 0) {
        links = storedLinks;
      }
    } else if (typeof storage.getDirectLinks === 'function') {
      const storedLinks = await storage.getDirectLinks();
      if (Array.isArray(storedLinks) && storedLinks.length > 0) {
        links = storedLinks;
      }
    }
  } catch (e) {
    console.warn('Could not load destination URLs from storage:', e);
  }

  if (links.length === 0) {
    const raw = localStorage.getItem(DESTINATION_URLS_STORAGE_KEY) || localStorage.getItem(LEGACY_DIRECT_LINKS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) links = parsed;
      } catch (e) {}
    }
  }

  if (links.length === 0 && Array.isArray(configLinks) && configLinks.length > 0) {
    links = configLinks;
  }

  if (typeof StorageManager !== 'undefined' && typeof StorageManager.normalizeDestinationUrls === 'function') {
    state.destinationUrls = StorageManager.normalizeDestinationUrls(links);
  } else {
    state.destinationUrls = (Array.isArray(links) ? links : [])
      .filter(item => item && typeof item === 'object' && String(item.url || '').trim())
      .map((item, idx) => ({
        id: item.id || `dest_${Date.now()}_${idx}`,
        name: String(item.name || '').trim() || `Destination ${idx + 1}`,
        url: String(item.url || '').trim()
      }));
  }

  return state.destinationUrls;
}

async function persistDestinationUrls(links) {
  let normalized;
  if (typeof StorageManager !== 'undefined' && typeof StorageManager.normalizeDestinationUrls === 'function') {
    normalized = StorageManager.normalizeDestinationUrls(links);
  } else {
    normalized = (Array.isArray(links) ? links : [])
      .filter(item => item && String(item.url || '').trim())
      .map((item, idx) => ({
        id: item.id || `dest_${Date.now()}_${idx}`,
        name: String(item.name || `Destination ${idx + 1}`).trim(),
        url: String(item.url || '').trim()
      }));
  }

  state.destinationUrls = normalized;
  try {
    const serialized = JSON.stringify(normalized);
    localStorage.setItem(DESTINATION_URLS_STORAGE_KEY, serialized);
    localStorage.setItem(LEGACY_DIRECT_LINKS_KEY, serialized);
  } catch (e) {}

  if (typeof storage.saveDestinationUrls === 'function') {
    try {
      await storage.saveDestinationUrls(normalized);
    } catch (e) {
      console.warn('Could not save destination URLs to storage:', e);
    }
  } else if (typeof storage.saveDirectLinks === 'function') {
    try {
      await storage.saveDirectLinks(normalized);
    } catch (e) {}
  }

  return normalized;
}

// Load backend config & network info
async function loadConfigAndNetwork() {
  try {
    // Remove any legacy hardcoded preset cache
    try { localStorage.removeItem('rocketscan_presets'); } catch (e) {}

    const [cfgRes, netRes] = await Promise.allSettled([
      SeafileApi.getConfig(),
      SeafileApi.getNetworkInfo()
    ]);

    const cfg = cfgRes.status === 'fulfilled' && cfgRes.value ? cfgRes.value : state.seafileConfig;
    const net = netRes.status === 'fulfilled' ? netRes.value : null;

    const cleanCfg = { ...cfg };
    delete cleanCfg.presets;
    state.seafileConfig = { ...state.seafileConfig, ...cleanCfg };
    state.networkInfo = net;

    await loadDestinationUrls(cfg.destinationUrls || cfg.directLinks);

    const versionElem = document.getElementById('settings-app-version');
    if (versionElem && cfg.version) {
      versionElem.textContent = cfg.version;
    }

    updateNetworkInfoUI();
    updateConnectionStatusUI();
    updateAutoSendUI();
    renderQuickDestinationPills();

    // Preload libraries if authenticated & auto-select if none chosen
    if (state.seafileConfig.hasToken && state.seafileConfig.serverUrl) {
      SeafileApi.getRepos().then(repos => {
        state.availableRepos = repos || [];
      }).catch(() => {});

      if (!state.seafileConfig.repoId) {
        SeafileApi.autoSelectRepo().then(res => {
          if (res && res.repoId) {
            state.seafileConfig.repoId = res.repoId;
            state.seafileConfig.repoName = res.repoName;
            updateConnectionStatusUI();
          }
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Initialization error:', err);
  }
}

function updateAutoSendUI() {
  const isAuto = Boolean(state.seafileConfig.autoUpload);
  const reviewToggle = document.getElementById('review-auto-send-toggle');
  const settingCheck = document.getElementById('setting-auto-upload');
  const finishBtnText = document.getElementById('btn-finish-doc-text');

  if (reviewToggle) reviewToggle.checked = isAuto;
  if (settingCheck) settingCheck.checked = isAuto;

  if (finishBtnText) {
    const isConnected = Boolean(state.seafileConfig.hasToken && state.seafileConfig.serverUrl);
    if (isAuto && isConnected) {
      finishBtnText.textContent = '1-Tap Auto-Send to Seafile';
    } else if (isConnected) {
      finishBtnText.textContent = 'Save & Seafile Backup';
    } else {
      finishBtnText.textContent = 'Save / Export';
    }
  }
}

async function handleToggleAutoSend(e) {
  const enabled = e.target.checked;
  state.seafileConfig.autoUpload = enabled;
  updateAutoSendUI();
  try {
    await SeafileApi.saveConfig({ autoUpload: enabled });
    showToast(enabled ? '1-Tap Auto-Send enabled' : '1-Tap Auto-Send turned off', 'info');
  } catch (err) {
    console.warn('Failed to save autoUpload setting:', err);
  }
}

function updateNetworkInfoUI() {
  const qrImg = document.getElementById('qr-code-img');
  const lanUrlElem = document.getElementById('lan-url-display');
  if (state.networkInfo) {
    if (qrImg) qrImg.src = state.networkInfo.qrCode;
    if (lanUrlElem) lanUrlElem.textContent = state.networkInfo.connectUrl;
  }
}

function updateConnectionStatusUI() {
  const badge = document.getElementById('seafile-status-badge');
  if (!badge) return;

  if (state.seafileConfig.hasToken && state.seafileConfig.serverUrl) {
    badge.className = 'status-badge connected';
    badge.innerHTML = `<span class="dot"></span> Seafile: Connected (${escapeHtml(state.seafileConfig.repoName || 'Library selected')})`;
  } else {
    badge.className = 'status-badge disconnected';
    badge.innerHTML = `<span class="dot"></span> Seafile: Optional (Not Connected)`;
  }
  updateAutoSendUI();
}

// Initialize Camera
async function initCamera() {
  const video = document.getElementById('camera-feed');
  const overlay = document.getElementById('camera-overlay');
  const fallbackCard = document.getElementById('camera-permission-fallback');
  const directBtn = document.getElementById('btn-camera-direct');
  if (!video) return;

  cameraScanner = new CameraScanner(video, overlay);
  try {
    const res = await cameraScanner.start();
    const torchBtn = document.getElementById('btn-torch');
    if (torchBtn) {
      torchBtn.style.display = res.hasTorch ? 'flex' : 'none';
    }
    if (fallbackCard) fallbackCard.style.display = 'none';
    if (directBtn) {
      directBtn.style.display = (CameraScanner.isIOS() || 'ontouchstart' in window) ? 'flex' : 'none';
    }
  } catch (err) {
    console.warn('Camera could not start immediately:', err);
    const placeholder = document.getElementById('camera-placeholder');
    if (placeholder) placeholder.classList.add('hidden');
    if (fallbackCard) fallbackCard.style.display = 'block';
    if (directBtn) directBtn.style.display = 'flex';
    showToast('Live camera paused or unavailable. Tap "Capture with Camera" for native photo shutter.', 'info');
  }
}

// UI Event Handlers & View Navigation
function initUI() {
  // Navigation tabs (Desktop header + Mobile bottom navigation bar)
  const openGallery = () => {
    closeSettingsModal();
    switchView('gallery');
    loadSeafileGallery();
  };
  const openScanner = () => {
    closeSettingsModal();
    switchView('scanner');
  };

  document.getElementById('nav-scanner')?.addEventListener('click', openScanner);
  document.getElementById('nav-gallery')?.addEventListener('click', openGallery);
  document.getElementById('nav-settings')?.addEventListener('click', () => openSettingsModal());

  document.getElementById('mobile-nav-scanner')?.addEventListener('click', openScanner);
  document.getElementById('mobile-nav-gallery')?.addEventListener('click', openGallery);
  document.getElementById('mobile-nav-settings')?.addEventListener('click', () => openSettingsModal());

  // Smart Seafile URL detection on paste/input
  document.getElementById('setting-server-url')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    const match = val.match(/^(https?:\/\/[^\/]+)\/library\/([0-9a-fA-F-]+)(?:\/([^\/]+))?(?:\/(.*))?/);
    if (match) {
      e.target.value = match[1];
      const repoId = match[2];
      const repoName = match[3] ? decodeURIComponent(match[3]) : 'scannednote';
      const subfolder = match[4] ? '/' + decodeURIComponent(match[4]).replace(/\/+$/, '') : '/';
      const folderInput = document.getElementById('setting-folder');
      if (folderInput) folderInput.value = subfolder;
      state.seafileConfig.serverUrl = match[1];
      state.seafileConfig.repoId = repoId;
      state.seafileConfig.repoName = repoName;
      state.seafileConfig.folder = subfolder;
      if (window.showToast) {
        showToast(`Detected Seafile Library "${repoName}" (${repoId.substring(0, 8)}...)`, 'info');
      }
    }
  });

  // Camera buttons
  document.getElementById('btn-capture')?.addEventListener('click', handleCapture);
  document.getElementById('btn-torch')?.addEventListener('click', handleToggleTorch);
  document.getElementById('file-gallery-input')?.addEventListener('change', handleFileImport);
  document.getElementById('btn-import-gallery')?.addEventListener('click', () => {
    document.getElementById('file-gallery-input')?.click();
  });

  // Direct iOS / Mobile Camera Fallback
  document.getElementById('btn-camera-direct')?.addEventListener('click', () => {
    document.getElementById('file-camera-direct')?.click();
  });
  document.getElementById('btn-fallback-camera')?.addEventListener('click', () => {
    document.getElementById('file-camera-direct')?.click();
  });
  document.getElementById('file-camera-direct')?.addEventListener('change', handleFileImport);

  // Crop / Corner editor controls
  document.getElementById('btn-crop-cancel')?.addEventListener('click', () => switchView('scanner'));
  document.getElementById('btn-crop-reset')?.addEventListener('click', handleResetCorners);
  document.getElementById('btn-crop-confirm')?.addEventListener('click', handleConfirmCrop);

  // Filter controls
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.currentTarget.dataset.filter;
      applySelectedFilter(filter);
    });
  });
  document.getElementById('btn-rotate-page')?.addEventListener('click', handleRotatePage);
  document.getElementById('btn-ocr-convert')?.addEventListener('click', openHandwritingConverterModal);
  document.getElementById('btn-add-page')?.addEventListener('click', handleAddAnotherPage);
  document.getElementById('btn-finish-doc')?.addEventListener('click', handleFinishDoc);
  document.getElementById('btn-filter-back')?.addEventListener('click', () => switchView('crop'));

  // Handwriting to Digital Font Converter controls
  document.getElementById('btn-close-ocr')?.addEventListener('click', closeHandwritingConverterModal);
  document.getElementById('btn-convert-all')?.addEventListener('click', () => handleRunConversion('all'));
  document.getElementById('btn-convert-selected')?.addEventListener('click', () => handleRunConversion('selected'));
  document.getElementById('btn-clear-selection')?.addEventListener('click', () => handwritingConverter?.clearSelection());
  document.getElementById('btn-revert-handwriting')?.addEventListener('click', () => {
    handwritingConverter?.revertAll();
    showToast('Reverted to original document', 'info');
  });
  document.getElementById('ocr-font-family')?.addEventListener('change', (e) => {
    handwritingConverter?.updateSettings({ fontFamily: e.target.value });
  });
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const color = e.currentTarget.dataset.color;
      handwritingConverter?.updateSettings({ color });
    });
  });
  const sizeSlider = document.getElementById('ocr-size-slider');
  const sizeValLabel = document.getElementById('ocr-size-val');
  if (sizeSlider) {
    sizeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (sizeValLabel) sizeValLabel.textContent = `${val}%`;
      handwritingConverter?.updateSettings({ sizeScale: val / 100 });
    });
  }
  document.getElementById('btn-copy-transcribed')?.addEventListener('click', () => {
    const text = handwritingConverter?.getFullTranscribedText() || '';
    if (!text) {
      showToast('No text transcribed yet.', 'info');
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Transcribed text copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Text copied!', 'info');
      });
    } else {
      showToast('Text copied!', 'info');
    }
  });
  document.getElementById('btn-apply-handwriting')?.addEventListener('click', () => {
    if (!handwritingConverter) return;
    handwritingConverter.applyToDocument();
    closeHandwritingConverterModal();
    showToast('Applied digital font to document.', 'success');
  });

  // Streamlined 1-Tap Export Buttons on Review Screen
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => handleDownloadExport('pdf'));
  document.getElementById('btn-export-jpeg')?.addEventListener('click', () => handleDownloadExport('jpeg'));
  document.getElementById('btn-export-share')?.addEventListener('click', () => handleWebShareCurrentDocument('pdf'));

  // Quick-Send Auto-Send Toggle
  document.getElementById('review-auto-send-toggle')?.addEventListener('change', handleToggleAutoSend);

  // Document Save & Export modal
  document.getElementById('btn-cancel-save')?.addEventListener('click', closeSaveDocModal);
  document.getElementById('btn-upload-seafile')?.addEventListener('click', handleUploadToSeafile);
  document.getElementById('btn-modal-save-pdf')?.addEventListener('click', () => handleDownloadExport('pdf'));
  document.getElementById('btn-modal-save-image')?.addEventListener('click', () => handleDownloadExport('jpeg'));
  document.getElementById('btn-modal-share-file')?.addEventListener('click', () => handleWebShareCurrentDocument('pdf'));

  // Direct QR Code Share Modal Controls
  document.getElementById('btn-close-qr-share')?.addEventListener('click', closeQrShareModal);
  document.getElementById('btn-done-qr-share')?.addEventListener('click', closeQrShareModal);
  document.getElementById('btn-copy-share-url')?.addEventListener('click', handleCopyQrShareUrl);
  document.getElementById('btn-open-share-url')?.addEventListener('click', handleOpenQrShareUrl);

  // Settings modal
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btn-test-connection')?.addEventListener('click', handleTestSeafileConnection);
  document.getElementById('btn-save-settings')?.addEventListener('click', handleSaveSettings);
  document.getElementById('seafile-login-form')?.addEventListener('submit', handleSeafileLogin);
  document.getElementById('btn-add-destination-url')?.addEventListener('click', handleAddDestinationUrl);
  document.getElementById('new-dest-url')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddDestinationUrl();
    }
  });
  document.getElementById('new-dest-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('new-dest-url')?.focus();
    }
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'modal-settings') {
          closeSettingsModal();
        } else {
          backdrop.classList.remove('active');
        }
      }
    });
  });

  // Apple / iOS Safari Touch Optimization (prevent double-tap zoom delay & unwanted gesture zoom)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      if (!['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(e.target.tagName)) {
        e.preventDefault();
      }
    }
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
  }, { passive: false });

  // Initialize iOS Add to Home Screen Banner
  initIosA2hs();

  // Setup interactive drag on crop canvas
  setupCropCanvasInteractions();
}

function syncNavActiveState(activeKey) {
  document.querySelectorAll('.nav-tab, .mobile-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`nav-${activeKey}`)?.classList.add('active');
  document.getElementById(`mobile-nav-${activeKey}`)?.classList.add('active');
}

function switchView(viewName) {
  state.view = viewName;
  document.querySelectorAll('.view-screen').forEach(el => el.classList.remove('active'));
  syncNavActiveState(viewName);

  const targetScreen = document.getElementById(`view-${viewName}`);
  if (targetScreen) targetScreen.classList.add('active');

  if (viewName === 'scanner') {
    if (cameraScanner && !cameraScanner.isActive) {
      cameraScanner.start().catch(() => {});
    }
  } else {
    if (cameraScanner && cameraScanner.isActive) {
      cameraScanner.stop();
    }
  }
}

// -------------------------------------------------------------
// Camera Capture & Gallery Import
// -------------------------------------------------------------
function handleCapture() {
  if (!cameraScanner) return;

  try {
    const frameCanvas = cameraScanner.captureFrame();
    const img = new Image();
    img.onload = () => {
      state.capturedImage = img;
      // Auto-detect page edges
      const corners = vision.detectDocumentEdges(img);
      state.corners = corners;
      openCropEditor();
    };
    img.src = frameCanvas.toDataURL('image/jpeg', 0.95);
  } catch (err) {
    showToast('Failed to capture frame: ' + err.message, 'error');
  }
}

function handleFileImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      state.capturedImage = img;
      const corners = vision.detectDocumentEdges(img);
      state.corners = corners;
      openCropEditor();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function handleToggleTorch() {
  if (!cameraScanner) return;
  const isEnabled = await cameraScanner.toggleTorch();
  const torchBtn = document.getElementById('btn-torch');
  if (torchBtn) {
    torchBtn.classList.toggle('active', isEnabled);
  }
}

// -------------------------------------------------------------
// Interactive Corner & Perspective Crop Editor
// -------------------------------------------------------------
function openCropEditor() {
  switchView('crop');
  renderCropCanvas();
}

function handleResetCorners() {
  if (!state.capturedImage) return;
  const w = state.capturedImage.naturalWidth;
  const h = state.capturedImage.naturalHeight;
  state.corners = vision.getDefaultCorners(w, h);
  renderCropCanvas();
}

function renderCropCanvas() {
  const canvas = document.getElementById('crop-canvas');
  if (!canvas || !state.capturedImage) return;

  const container = canvas.parentElement;
  const maxW = container.clientWidth || window.innerWidth;
  const maxH = container.clientHeight || (window.innerHeight - 150);

  const imgW = state.capturedImage.naturalWidth;
  const imgH = state.capturedImage.naturalHeight;

  const scale = Math.min(maxW / imgW, maxH / imgH);
  canvas.width = Math.round(imgW * scale);
  canvas.height = Math.round(imgH * scale);

  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.capturedImage, 0, 0, canvas.width, canvas.height);

  if (!state.corners) return;

  // Transform coordinates to display canvas scale
  const displayCorners = state.corners.map(p => ({
    x: p.x * scale,
    y: p.y * scale
  }));

  // Draw polygon path
  ctx.beginPath();
  ctx.moveTo(displayCorners[0].x, displayCorners[0].y);
  ctx.lineTo(displayCorners[1].x, displayCorners[1].y);
  ctx.lineTo(displayCorners[2].x, displayCorners[2].y);
  ctx.lineTo(displayCorners[3].x, displayCorners[3].y);
  ctx.closePath();

  // Polygon fill with pleasant transparent blue
  ctx.fillStyle = 'rgba(37, 99, 235, 0.20)';
  ctx.fill();

  // Polygon boundary stroke
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2563eb';
  ctx.stroke();

  // Draw circular corner handles with glowing centers
  displayCorners.forEach((p, idx) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

// Setup touch and mouse drag interactions on the crop canvas
function setupCropCanvasInteractions() {
  const canvas = document.getElementById('crop-canvas');
  const loupe = document.getElementById('crop-loupe');
  const loupeCanvas = document.getElementById('crop-loupe-canvas');
  if (!canvas) return;

  let isDragging = false;
  let activeIndex = -1;

  const getCanvasCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      clientX,
      clientY
    };
  };

  const onPointerDown = (e) => {
    if (!state.corners || !state.capturedImage) return;
    const pos = getCanvasCoords(e);
    const scale = canvas.width / state.capturedImage.naturalWidth;

    const hitRadius = 36; // forgiving touch target
    let bestDist = hitRadius;
    activeIndex = -1;

    state.corners.forEach((p, idx) => {
      const cx = p.x * scale;
      const cy = p.y * scale;
      const d = Math.hypot(pos.x - cx, pos.y - cy);
      if (d < bestDist) {
        bestDist = d;
        activeIndex = idx;
      }
    });

    if (activeIndex !== -1) {
      isDragging = true;
      state.activeCornerIndex = activeIndex;
      showLoupe(pos.clientX, pos.clientY, pos.x, pos.y);
      e.preventDefault();
    }
  };

  const onPointerMove = (e) => {
    if (!isDragging || activeIndex === -1 || !state.capturedImage) return;
    const pos = getCanvasCoords(e);
    const scale = canvas.width / state.capturedImage.naturalWidth;

    // Constrain within image boundaries
    const rawX = Math.max(0, Math.min(state.capturedImage.naturalWidth, pos.x / scale));
    const rawY = Math.max(0, Math.min(state.capturedImage.naturalHeight, pos.y / scale));

    state.corners[activeIndex] = { x: rawX, y: rawY };
    renderCropCanvas();
    showLoupe(pos.clientX, pos.clientY, pos.x, pos.y);
    e.preventDefault();
  };

  const onPointerUp = () => {
    if (isDragging) {
      isDragging = false;
      activeIndex = -1;
      state.activeCornerIndex = null;
      hideLoupe();
    }
  };

  const showLoupe = (clientX, clientY, canvasX, canvasY) => {
    if (!loupe || !loupeCanvas || !state.capturedImage) return;
    loupe.style.display = 'block';

    // Position loupe offset from user's finger so finger doesn't obscure it
    const offset = 80;
    loupe.style.left = `${clientX - 60}px`;
    loupe.style.top = `${clientY - offset - 120}px`;

    const scale = canvas.width / state.capturedImage.naturalWidth;
    const rawX = canvasX / scale;
    const rawY = canvasY / scale;

    const lCtx = loupeCanvas.getContext('2d');
    const zoomSize = 80; // Region around corner to zoom
    lCtx.drawImage(
      state.capturedImage,
      rawX - zoomSize / 2, rawY - zoomSize / 2, zoomSize, zoomSize,
      0, 0, loupeCanvas.width, loupeCanvas.height
    );
  };

  const hideLoupe = () => {
    if (loupe) loupe.style.display = 'none';
  };

  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
}

// Confirm Crop -> Runs Perspective Warping -> Opens Filter Screen
function handleConfirmCrop() {
  if (!state.capturedImage || !state.corners) return;

  try {
    showLoading('Processing document perspective...');
    setTimeout(() => {
      // Warp perspective
      const warpedCanvas = vision.warpPerspective(state.capturedImage, state.corners);
      state.rawWarpedCanvas = warpedCanvas;
      state.activeFilter = state.seafileConfig.filterDefault || 'magic';

      // Open filter screen
      switchView('filter');
      applySelectedFilter(state.activeFilter);
      hideLoading();
    }, 50);
  } catch (err) {
    hideLoading();
    showToast('Perspective warp error: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// Filter & Page Processing
// -------------------------------------------------------------
function applySelectedFilter(filterType) {
  if (!state.rawWarpedCanvas) return;
  state.activeFilter = filterType;

  // Update filter buttons UI
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filterType);
  });

  // Make a clean clone of the warped canvas to apply filter
  const cloneCanvas = document.createElement('canvas');
  cloneCanvas.width = state.rawWarpedCanvas.width;
  cloneCanvas.height = state.rawWarpedCanvas.height;
  const ctx = cloneCanvas.getContext('2d');
  ctx.drawImage(state.rawWarpedCanvas, 0, 0);

  const filtered = vision.applyFilter(cloneCanvas, filterType);
  state.activePageCanvas = filtered;
  state.activePageSavedLocally = false;

  // Display on preview element
  const previewImg = document.getElementById('filter-preview-img');
  if (previewImg) {
    previewImg.src = filtered.toDataURL('image/jpeg', 0.92);
  }
}

function handleRotatePage() {
  if (!state.rawWarpedCanvas) return;

  const w = state.rawWarpedCanvas.width;
  const h = state.rawWarpedCanvas.height;

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = h;
  rotCanvas.height = w;
  const ctx = rotCanvas.getContext('2d');

  ctx.translate(h / 2, w / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(state.rawWarpedCanvas, -w / 2, -h / 2);

  state.rawWarpedCanvas = rotCanvas;
  applySelectedFilter(state.activeFilter);
}

// -------------------------------------------------------------
// Handwriting to Digital Font Converter
// -------------------------------------------------------------
function openHandwritingConverterModal() {
  if (!state.activePageCanvas) {
    showToast('Please capture and adjust a page first.', 'info');
    return;
  }

  const stageContainer = document.getElementById('ocr-stage-container');
  const modal = document.getElementById('modal-handwriting-converter');
  if (!stageContainer || !modal) return;

  if (!handwritingConverter) {
    handwritingConverter = new HandwritingConverter();
  }

  handwritingConverter.init(stageContainer, state.activePageCanvas, (updatedCanvas, transcribedText) => {
    // When applied, update current active page
    state.activePageCanvas = updatedCanvas;
    state.activePageSavedLocally = false;
    state.lastTranscribedText = transcribedText;
    const previewImg = document.getElementById('filter-preview-img');
    if (previewImg) {
      previewImg.src = updatedCanvas.toDataURL('image/jpeg', 0.95);
    }
  });

  // Enable/disable "Convert Selected" button when user selects an area
  const btnConvertSelected = document.getElementById('btn-convert-selected');
  const btnClearSelection = document.getElementById('btn-clear-selection');
  
  const origRenderOverlay = handwritingConverter.renderOverlay.bind(handwritingConverter);
  handwritingConverter.renderOverlay = function() {
    origRenderOverlay();
    const hasSelection = Boolean(this.selectedBox && this.selectedBox.width > 20 && this.selectedBox.height > 20);
    if (btnConvertSelected) btnConvertSelected.disabled = !hasSelection;
    if (btnClearSelection) btnClearSelection.style.display = hasSelection ? 'inline-block' : 'none';
  };

  modal.classList.add('active');
}

function closeHandwritingConverterModal() {
  const modal = document.getElementById('modal-handwriting-converter');
  if (modal) modal.classList.remove('active');
  const inlineEditor = document.getElementById('ocr-inline-editor');
  if (inlineEditor) inlineEditor.remove();
}

async function handleRunConversion(mode) {
  if (!handwritingConverter) return;
  try {
    showLoading(mode === 'selected' ? 'Recognizing handwritten area...' : 'Recognizing page handwriting...');
    const result = await handwritingConverter.processConversion(mode);
    hideLoading();
    if (result.count === 0) {
      showToast('No handwriting detected in this area. Drawings were preserved.', 'info');
    } else {
      showToast(`Converted ${result.count} text line${result.count > 1 ? 's' : ''} to digital font. Drawings preserved.`, 'success');
    }
  } catch (err) {
    hideLoading();
    showToast('OCR Error: ' + err.message, 'error');
  }
}

function handleAddAnotherPage() {
  if (!state.activePageCanvas) return;

  const newPage = {
    id: Date.now(),
    canvas: state.activePageCanvas,
    filter: state.activeFilter,
    _savedLocally: Boolean(state.activePageSavedLocally)
  };
  // Save current page to batch
  state.pages.push(newPage);
  saveScanCopyLocally([newPage], { title: document.getElementById('save-doc-title')?.value?.trim() || '' }).catch(() => {});

  state.activePageCanvas = null;
  state.activePageSavedLocally = false;
  updatePageBadge();
  showToast(`Page ${state.pages.length} saved. Scan next page!`, 'success');
  switchView('scanner');
}

function updatePageBadge() {
  const badge = document.getElementById('scanner-page-badge');
  const countSpan = document.getElementById('scanner-page-count');
  if (!badge || !countSpan) return;

  const count = state.pages.length;
  countSpan.textContent = count;
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

// -------------------------------------------------------------
// Document Save, PDF Generation & Seafile Upload
// -------------------------------------------------------------
function handleFinishDoc() {
  if (state.seafileConfig.autoUpload && state.seafileConfig.hasToken && state.seafileConfig.serverUrl) {
    // 1-Tap Auto-Send: instantly upload to default library/folder
    handleUploadToSeafile();
  } else {
    // Open modal for preview, title edit, local download, share, or direct link upload
    openSaveDocModal();
  }
}

function openSaveDocModal() {
  if (!state.activePageCanvas && state.pages.length === 0) {
    showToast('Please scan at least one page first.', 'info');
    return;
  }

  // If there's an unsaved active page, add it
  if (state.activePageCanvas) {
    state.pages.push({
      id: Date.now(),
      canvas: state.activePageCanvas,
      filter: state.activeFilter
    });
    state.activePageCanvas = null;
    updatePageBadge();
  }

  // Generate default title e.g. "Notes_2026-11-15_1605"
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const defaultTitle = `Notes_${dateStr}_${timeStr}`;

  const titleInput = document.getElementById('save-doc-title');
  if (titleInput) titleInput.value = defaultTitle;

  const pageCountSpan = document.getElementById('save-page-count');
  if (pageCountSpan) pageCountSpan.textContent = `${state.pages.length} page${state.pages.length > 1 ? 's' : ''}`;

  // Populate target library info
  const repoDisplay = document.getElementById('save-repo-display');
  if (repoDisplay) {
    repoDisplay.textContent = state.seafileConfig.repoName || 'Default Library';
  }

  renderQuickDestinationPills();

  const modal = document.getElementById('modal-save-doc');
  if (modal) modal.classList.add('active');
}

function closeSaveDocModal() {
  const modal = document.getElementById('modal-save-doc');
  if (modal) modal.classList.remove('active');
}

function formatDestinationUrlSubtitle(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    const pathPart = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const combined = `${parsed.host}${pathPart}`;
    return combined.length > 34 ? `${combined.slice(0, 31)}...` : combined;
  } catch (e) {
    return clean.length > 34 ? `${clean.slice(0, 31)}...` : clean;
  }
}

// Render Quick Destination Pills (ONLY user-added Destination URLs)
function renderQuickDestinationPills() {
  const containers = [
    { el: document.getElementById('quick-dest-pills'), isReviewBar: true },
    { el: document.getElementById('modal-quick-dest-pills'), isReviewBar: false }
  ];

  const urls = Array.isArray(state.destinationUrls)
    ? state.destinationUrls.filter(item => item && item.url && String(item.url).trim())
    : [];

  containers.forEach(({ el: container }) => {
    if (!container) return;
    container.innerHTML = '';

    // Empty state: clean prompt to add a Destination URL
    if (urls.length === 0) {
      const promptBtn = document.createElement('button');
      promptBtn.type = 'button';
      promptBtn.id = container.id === 'quick-dest-pills' ? 'btn-empty-dest-prompt' : 'btn-modal-empty-dest-prompt';
      promptBtn.className = 'dest-pill dest-empty-prompt';
      promptBtn.style.borderStyle = 'dashed';
      promptBtn.style.color = 'var(--text-muted)';
      promptBtn.style.width = '100%';
      promptBtn.style.justifyContent = 'center';
      promptBtn.textContent = 'No destination URLs configured. Tap to add URL';
      promptBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSaveDocModal();
        openSettingsModal({ focusDestinationUrls: true });
      });
      container.appendChild(promptBtn);
      return;
    }

    // Render ONLY user-added Destination URLs as 1-tap pills
    urls.forEach(dest => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'dest-pill dest-pill-direct';
      pill.style.borderColor = 'var(--accent)';
      pill.title = `1-Tap Send to ${dest.name || dest.url} (${dest.url})`;
      pill.setAttribute('data-destination-id', dest.id);
      pill.setAttribute('data-destination-url', dest.url);

      const subtitle = formatDestinationUrlSubtitle(dest.url);
      pill.innerHTML = `
        <span class="dest-pill-name">${escapeHtml(dest.name || subtitle)}</span>
        <span class="dest-pill-folder">${escapeHtml(subtitle)}</span>
      `;

      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSendToDestinationUrl(dest);
      });

      container.appendChild(pill);
    });
  });
}

// 1-Tap Quick-Send to configured Destination URL (no Seafile login required)
async function handleSendToDestinationUrl(destOrUrl, customName = '') {
  const targetUrl = typeof destOrUrl === 'string' ? destOrUrl.trim() : String(destOrUrl?.url || '').trim();
  const destName = (typeof destOrUrl === 'object' ? destOrUrl?.name : customName) || formatDestinationUrlSubtitle(targetUrl) || 'Destination URL';

  if (!targetUrl) {
    showToast('Please enter a valid destination URL.', 'warning');
    return;
  }

  // Include active page if present
  if (state.activePageCanvas) {
    state.pages.push({
      id: Date.now(),
      canvas: state.activePageCanvas,
      filter: state.activeFilter
    });
    state.activePageCanvas = null;
    updatePageBadge();
  }

  if (state.pages.length === 0) {
    showToast('Please scan or import at least one page first.', 'info');
    return;
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
    const titleInput = document.getElementById('save-doc-title')?.value?.trim();
    const baseName = titleInput || destName.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'NoteScan';
    const fileName = `${baseName}_${dateStr}_${timeStr}.pdf`;

    showToast(`Sending to ${destName}...`, 'info');
    showLoading(`Compiling PDF and sending to ${destName}...`);

    const pdfBlob = await PdfBuilder.createPdfFromPages(state.pages);

    if (typeof SeafileApi.sendToDirectLink !== 'function') {
      throw new Error('Destination URL upload is not available.');
    }
    await SeafileApi.sendToDirectLink(targetUrl, pdfBlob, fileName);
    await saveScanCopyLocally(state.pages, { title: baseName });

    hideLoading();
    closeSaveDocModal();

    showToast(`Sent "${fileName}" to ${destName}.`, 'success');

    // Reset current batch for next scan
    state.pages = [];
    state.activePageCanvas = null;
    updatePageBadge();
  } catch (err) {
    hideLoading();
    showToast('Upload error: ' + err.message, 'error');
  }
}
const handleQuickSendDirectLink = handleSendToDestinationUrl;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file data'));
    reader.readAsDataURL(blob);
  });
}

async function saveBlobToDevice(blob, filename, mimeType = 'application/octet-stream') {
  if (window.NoteScanNative && typeof window.NoteScanNative.saveFileToDevice === 'function') {
    const dataUrl = await blobToDataUrl(blob);
    const rawRes = window.NoteScanNative.saveFileToDevice(dataUrl, filename, mimeType);
    const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
    if (parsed && parsed.success) {
      return parsed;
    }
    throw new Error(parsed?.error || 'Native save failed');
  }

  ExportManager.downloadBlob(blob, filename);
  return { success: true, fileName: filename, location: 'Downloads' };
}

async function saveScanCopyLocally(pages, options = {}) {
  const targetPages = Array.isArray(pages) && pages.length > 0 ? pages : collectPagesForExport();
  if (targetPages.length === 0) return [];

  const shouldDownloadToGallery = state.seafileConfig.saveCopyToGallery !== false && !options.skipDownload;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
  const baseTitle = ExportManager.sanitizeFilename(options.title || `NoteScan_${dateStr}_${timeStr}`);

  const savedResults = [];
  for (let idx = 0; idx < targetPages.length; idx++) {
    const page = targetPages[idx];
    if (!page || !page.canvas) continue;
    if (!options.force && (page._savedLocally || (page.canvas === state.activePageCanvas && state.activePageSavedLocally))) {
      continue;
    }

    try {
      const imgRes = await ExportManager.createImage(page.canvas, 'jpeg', {
        title: baseTitle,
        pageNumber: targetPages.length > 1 ? idx + 1 : undefined,
        quality: 0.95
      });

      const dataUrl = page.canvas.toDataURL('image/jpeg', 0.95);
      if (typeof storage.saveDocument === 'function') {
        await storage.saveDocument({
          id: `scan_${page.id || Date.now()}_${idx}`,
          title: imgRes.filename,
          createdAt: Date.now(),
          pageCount: 1,
          filter: page.filter || state.activeFilter || 'magic',
          mimeType: 'image/jpeg',
          size: imgRes.size,
          imageDataUrl: dataUrl
        });
      }

      if (shouldDownloadToGallery) {
        await saveBlobToDevice(imgRes.blob, imgRes.filename, 'image/jpeg');
      }

      page._savedLocally = true;
      if (page.canvas === state.activePageCanvas) {
        state.activePageSavedLocally = true;
      }
      savedResults.push(imgRes);
    } catch (err) {
      console.warn('Could not save local JPEG copy:', err);
    }
  }
  return savedResults;
}

function collectPagesForExport() {
  const pagesToExport = [...state.pages];
  if (state.activePageCanvas) {
    pagesToExport.push({
      id: Date.now(),
      canvas: state.activePageCanvas,
      filter: state.activeFilter,
      _savedLocally: Boolean(state.activePageSavedLocally)
    });
  }
  return pagesToExport;
}

async function handleDownloadExport(format = 'pdf', options = {}) {
  try {
    const fmt = format.toLowerCase();
    showLoading(`Exporting document as ${fmt.toUpperCase()}...`);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const title = (document.getElementById('save-doc-title')?.value || `Notes_${dateStr}_${timeStr}`).trim();

    const pagesToExport = collectPagesForExport();
    if (pagesToExport.length === 0) {
      hideLoading();
      showToast('No pages available to export', 'warning');
      return;
    }

    if (fmt === 'jpeg' || fmt === 'jpg') {
      const savedImgs = await saveScanCopyLocally(pagesToExport, {
        title,
        force: true,
        skipDownload: false
      });
      if (savedImgs.length === 0) {
        throw new Error('Could not generate JPEG image');
      }
      hideLoading();
      showToast(`Saved ${savedImgs.length > 1 ? `${savedImgs.length} images` : savedImgs[0].filename} to device!`, 'success');
      return savedImgs[0];
    }

    const result = await ExportManager.exportDocument(pagesToExport, format, {
      title,
      pageSize: options.pageSize || 'a4',
      orientation: options.orientation || 'auto',
      quality: options.quality || 0.90,
      ...options
    });

    await saveBlobToDevice(result.blob, result.filename, result.mimeType);
    await saveScanCopyLocally(pagesToExport, { title });

    hideLoading();
    showToast(`Saved ${result.filename} successfully!`, 'success');
    return result;
  } catch (err) {
    hideLoading();
    showToast(`Failed to export ${format}: ${err.message}`, 'error');
    console.error('Export error:', err);
  }
}

async function handleDownloadLocalPdf() {
  return handleDownloadExport('pdf');
}
window.handleDownloadExport = handleDownloadExport;

// -------------------------------------------------------------
// Direct Sharing to People & Devices (Web Share API & QR Code)
// -------------------------------------------------------------
async function handleWebShareCurrentDocument(format = 'pdf') {
  try {
    const pagesToShare = collectPagesForExport();
    if (pagesToShare.length === 0) {
      showToast('Please scan at least one page first.', 'info');
      return;
    }

    const title = (document.getElementById('save-doc-title')?.value || 'Scanned_Notes').trim();
    showLoading(`Preparing ${format.toUpperCase()} for sharing...`);

    await saveScanCopyLocally(pagesToShare, { title });
    const result = await ExportManager.exportDocument(pagesToShare, format, { title });
    hideLoading();

    const file = new File([result.blob], result.filename, { type: result.mimeType });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: title,
        text: `Scanned note: ${title}`,
        files: [file]
      });
      showToast('Shared successfully!', 'success');
      return;
    }

    if (navigator.share) {
      await navigator.share({
        title: title,
        text: `NoteScan: ${title}`
      });
      showToast('Shared via system share!', 'success');
      return;
    }

    // Fallback: Open QR share modal
    openQrShareModal({
      title: result.filename,
      info: 'System file sharing is not supported in this browser. Use QR code or download directly.'
    });
  } catch (err) {
    hideLoading();
    if (err.name !== 'AbortError') {
      showToast('Share failed: ' + err.message, 'error');
    }
  }
}

async function handleOpenQrShareForCurrent() {
  try {
    showLoading('Generating QR Share code...');
    const title = (document.getElementById('save-doc-title')?.value || 'Scanned_Notes').trim();

    let shareUrl = '';
    try {
      const net = await SeafileApi.getNetworkInfo();
      shareUrl = net.connectUrl || window.location.href;
    } catch (e) {
      shareUrl = window.location.href;
    }

    hideLoading();
    openQrShareModal({
      title,
      url: shareUrl,
      info: `Scan this QR code with any smartphone or tablet to download or view "${title}".`
    });
  } catch (e) {
    hideLoading();
    showToast('Could not generate QR share code: ' + e.message, 'error');
  }
}

async function openQrShareModal(options = {}) {
  const modal = document.getElementById('modal-qr-share');
  const canvas = document.getElementById('qr-share-canvas');
  const img = document.getElementById('qr-share-image');
  const urlInput = document.getElementById('qr-share-url-input');
  const infoText = document.getElementById('qr-share-info-text');
  if (!modal) return;

  const url = options.url || window.location.href;
  const title = options.title || 'Document';

  if (urlInput) urlInput.value = url;
  if (infoText) infoText.textContent = options.info || `Direct share link for "${title}". Scan with any camera to open immediately.`;

  // Render QR code onto canvas using bundled QRCodeLib
  try {
    if (window.QRCodeLib && window.QRCodeLib.toCanvas && canvas) {
      canvas.style.display = 'block';
      if (img) img.style.display = 'none';
      await window.QRCodeLib.toCanvas(canvas, url, {
        width: 240,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    } else if (img) {
      const res = await fetch(`/api/qrcode?text=${encodeURIComponent(url)}`);
      const data = await res.json();
      img.src = data.qrCode;
      img.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
    }
  } catch (err) {
    console.warn('[QR Share] Render error:', err);
  }

  modal.classList.add('active');
}

function closeQrShareModal() {
  const modal = document.getElementById('modal-qr-share');
  if (modal) modal.classList.remove('active');
}

async function handleCopyQrShareUrl() {
  const urlInput = document.getElementById('qr-share-url-input');
  if (!urlInput || !urlInput.value) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(urlInput.value);
    } else {
      urlInput.select();
      document.execCommand('copy');
    }
    showToast('Share link copied to clipboard.', 'success');
  } catch (err) {
    showToast('Could not copy link: ' + err.message, 'error');
  }
}

function handleOpenQrShareUrl() {
  const urlInput = document.getElementById('qr-share-url-input');
  if (urlInput && urlInput.value) {
    window.open(urlInput.value, '_blank');
  }
}

function initIosA2hs() {
  const isIOS = CameraScanner.isIOS();
  const isStandalone = Boolean(window.navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
  const dismissed = localStorage.getItem('notescan_a2hs_dismissed') === 'true';

  const banner = document.getElementById('ios-a2hs-banner');
  if (!banner) return;

  if (isIOS && !isStandalone && !dismissed) {
    setTimeout(() => {
      banner.style.display = 'block';
    }, 2500);
  }

  document.getElementById('btn-close-a2hs')?.addEventListener('click', () => {
    banner.style.display = 'none';
    localStorage.setItem('notescan_a2hs_dismissed', 'true');
  });
}

async function handleQrShareNote(file) {
  try {
    showLoading('Generating QR Code for Seafile note...');
    let link = '';
    try {
      const shareRes = await SeafileApi.createShareLink(state.seafileConfig.repoId, file.fullPath);
      link = shareRes.shareUrl || shareRes.link;
    } catch (e) {
      link = await SeafileApi.getFileUrl(state.seafileConfig.repoId, file.fullPath);
    }
    hideLoading();

    openQrShareModal({
      title: file.name,
      url: link,
      info: `Scan to download "${file.name}" directly from Seafile to your phone.`
    });
  } catch (err) {
    hideLoading();
    showToast('Failed to generate note QR: ' + err.message, 'error');
  }
}

async function handleWebShareNote(file) {
  try {
    showLoading('Preparing note link for sharing...');
    let link = '';
    try {
      const shareRes = await SeafileApi.createShareLink(state.seafileConfig.repoId, file.fullPath);
      link = shareRes.shareUrl || shareRes.link;
    } catch (e) {
      link = await SeafileApi.getFileUrl(state.seafileConfig.repoId, file.fullPath);
    }
    hideLoading();

    if (navigator.share) {
      await navigator.share({
        title: file.name,
        text: `NoteScan Document: ${file.name}`,
        url: link
      });
      showToast('Shared successfully!', 'success');
    }
  } catch (err) {
    hideLoading();
    if (err.name !== 'AbortError') {
      showToast('Share failed: ' + err.message, 'error');
    }
  }
}

async function handleUploadToSeafile() {
  if (!state.seafileConfig.serverUrl || !state.seafileConfig.hasToken) {
    showToast('Please configure your Seafile server connection in Settings first.', 'warning');
    closeSaveDocModal();
    openSettingsModal();
    return;
  }

  // Include active page if present
  if (state.activePageCanvas) {
    state.pages.push({
      id: Date.now(),
      canvas: state.activePageCanvas,
      filter: state.activeFilter
    });
    state.activePageCanvas = null;
    updatePageBadge();
  }

  if (state.pages.length === 0) {
    showToast('Please scan or import at least one page first.', 'info');
    return;
  }

  const targetRepoId = state.seafileConfig.repoId;
  const targetFolder = state.seafileConfig.folder || '/';

  if (!targetRepoId) {
    showToast('Please select a target Seafile library in Settings first.', 'warning');
    openSettingsModal();
    return;
  }

  try {
    showLoading('Compiling PDF and uploading to Seafile...');
    const titleInput = document.getElementById('save-doc-title')?.value?.trim();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const title = titleInput || `Notes_${dateStr}_${timeStr}`;
    const fileName = `${title}.pdf`;

    const pdfBlob = await PdfBuilder.createPdfFromPages(state.pages);

    const uploadRes = await SeafileApi.uploadFile(
      pdfBlob,
      fileName,
      targetRepoId,
      targetFolder
    );
    await saveScanCopyLocally(state.pages, { title });

    hideLoading();
    closeSaveDocModal();

    const cleanFolder = targetFolder.replace(/^\/+|\/+$/g, '');
    const cleanPath = cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
    const viewUrl = uploadRes.viewUrl || (state.seafileConfig.serverUrl ? `${state.seafileConfig.serverUrl.replace(/\/+$/, '')}/#common/lib/${targetRepoId}/${encodeURIComponent(cleanPath)}` : '');

    // Immediate visual feedback toast with link/button to view in Seafile & Share link
    showToast(`Uploaded "${fileName}" to Seafile.`, 'success', {
      label: 'Get Share Link',
      onClick: async () => {
        try {
          showLoading('Generating Seafile public share link...');
          const share = await SeafileApi.createShareLink(targetRepoId, `/${cleanPath}`);
          hideLoading();
          const shareUrl = share.shareUrl || share.link;
          if (shareUrl) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(shareUrl).catch(() => {});
            }
            showToast(`Public link copied: ${shareUrl}`, 'success', {
              label: 'Open URL',
              onClick: () => window.open(shareUrl, '_blank')
            });
          }
        } catch (e) {
          hideLoading();
          showToast('Failed to create share link: ' + e.message, 'error');
        }
      }
    });

    // Reset current batch
    state.pages = [];
    state.activePageCanvas = null;
    updatePageBadge();

    // Switch to gallery to show newly uploaded note
    switchView('gallery');
    loadSeafileGallery();
  } catch (err) {
    hideLoading();
    showToast('Upload error: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// PC Desktop Gallery & Seafile Explorer
// -------------------------------------------------------------
async function loadSeafileGallery() {
  const grid = document.getElementById('gallery-grid');
  const emptyState = document.getElementById('gallery-empty');
  if (!grid) return;

  if (!state.seafileConfig.hasToken || !state.seafileConfig.serverUrl) {
    if (emptyState) emptyState.style.display = 'none';
    grid.innerHTML = `
      <div class="gallery-error">
        <p>Seafile account not connected (optional).</p>
        <p class="text-sm text-muted">You can scan, export locally, or send via Direct Upload Links without logging in. Connect a Seafile account in Settings to browse your Seafile library.</p>
        <button class="btn btn-secondary mt-2" onclick="openSettingsModal()">Open Settings</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Syncing notes with Seafile...</p></div>';

  try {
    const res = await SeafileApi.getFiles(state.seafileConfig.repoId, state.seafileConfig.folder);
    const files = res.files || [];
    state.seafileFiles = files;

    grid.innerHTML = '';
    if (files.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const pdfIconSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    const imgIconSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

    files.forEach(file => {
      const card = document.createElement('div');
      card.className = 'note-card';

      const dateStr = file.mtime ? new Date(file.mtime * 1000).toLocaleString() : '';
      const sizeStr = file.size ? `${(file.size / 1024).toFixed(1)} KB` : '';

      card.innerHTML = `
        <div class="note-card-icon" style="display:flex;align-items:center;color:var(--accent);">
          ${file.isPdf ? pdfIconSvg : imgIconSvg}
        </div>
        <div class="note-card-body">
          <div class="note-card-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="note-card-meta">${escapeHtml(dateStr)} • ${escapeHtml(sizeStr)}</div>
        </div>
        <div class="note-card-actions">
          <button class="btn-icon btn-open-note" data-path="${escapeHtml(file.fullPath)}" title="View / Download">
            Open
          </button>
          <button class="btn-icon btn-share-note" data-path="${escapeHtml(file.fullPath)}" title="Generate & Copy Public Share Link">
            Link
          </button>
          <button class="btn-icon btn-qr-note" data-path="${escapeHtml(file.fullPath)}" title="Scan QR Code to Download on Phone">
            QR
          </button>
          ${navigator.share ? `
          <button class="btn-icon btn-webshare-note" data-path="${escapeHtml(file.fullPath)}" title="Share via AirDrop, WhatsApp, Slack">
            Share
          </button>` : ''}
        </div>
      `;

      card.querySelector('.btn-open-note')?.addEventListener('click', () => openSeafileDocument(file));
      card.querySelector('.btn-share-note')?.addEventListener('click', () => shareSeafileDocument(file));
      card.querySelector('.btn-qr-note')?.addEventListener('click', () => handleQrShareNote(file));
      card.querySelector('.btn-webshare-note')?.addEventListener('click', () => handleWebShareNote(file));
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `
      <div class="gallery-error">
        <p>Could not connect to Seafile library.</p>
        <p class="text-sm">${escapeHtml(err.message)}</p>
        <button class="btn btn-secondary mt-2" onclick="openSettingsModal()">Check Settings</button>
      </div>
    `;
  }
}

async function openSeafileDocument(file) {
  try {
    showLoading('Fetching file link from Seafile...');
    const url = await SeafileApi.getFileUrl(state.seafileConfig.repoId, file.fullPath);
    hideLoading();
    window.open(url, '_blank');
  } catch (err) {
    hideLoading();
    showToast('Failed to open file: ' + err.message, 'error');
  }
}

async function shareSeafileDocument(file) {
  try {
    showLoading('Generating Seafile public share link...');
    const result = await SeafileApi.createShareLink(state.seafileConfig.repoId, file.fullPath);
    hideLoading();

    const link = result.shareUrl || result.link || result.shared_link;
    if (link) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link).catch(() => {});
      }
      showToast('Public share link copied to clipboard.', 'success', {
        label: 'Open URL',
        onClick: () => window.open(link, '_blank')
      });
    } else {
      showToast('Could not generate share link.', 'warning');
    }
  } catch (err) {
    hideLoading();
    showToast('Failed to generate share link: ' + err.message, 'error');
  }
}

// Health check function for Settings modal
async function runSeafileHealthCheck() {
  const detailsBox = document.getElementById('seafile-health-details');
  if (!detailsBox) return;

  detailsBox.style.display = 'block';
  detailsBox.className = 'health-status-box';
  detailsBox.innerHTML = 'Connecting to Seafile server to test latency & health...';

  try {
    const health = await SeafileApi.checkHealth();
    if (health.healthy) {
      detailsBox.className = 'health-status-box healthy';
      detailsBox.innerHTML = `
        <strong>Healthy Seafile Connection</strong><br>
        <span>Latency: <strong>${health.latencyMs}ms</strong></span> • 
        <span>User: <strong>${escapeHtml(health.account?.email || health.account?.name || 'Authenticated')}</strong></span><br>
        <span>Active Library: <strong>${escapeHtml(health.activeRepoName || health.libraryInfo?.activeRepoName || 'Auto-selected')}</strong> (${health.libraryInfo?.totalLibraries || 0} total)</span>
      `;
    } else {
      detailsBox.className = 'health-status-box unhealthy';
      detailsBox.innerHTML = `
        <strong>Connection Issue</strong><br>
        <span>Status: ${escapeHtml(health.status || 'Unhealthy')}</span><br>
        <span class="text-xs">${escapeHtml(health.error || health.message || 'Check URL and token.')}</span>
      `;
    }
  } catch (err) {
    detailsBox.className = 'health-status-box unhealthy';
    detailsBox.innerHTML = `<strong>Error checking health:</strong> ${err.message}`;
  }
}

// -------------------------------------------------------------
// Settings Modal & Seafile Connection Manager
// -------------------------------------------------------------
function openSettingsModal(options = {}) {
  const modal = document.getElementById('modal-settings');
  if (!modal) return;

  syncNavActiveState('settings');

  const urlInput = document.getElementById('setting-server-url');
  const tokenInput = document.getElementById('setting-token');
  const folderInput = document.getElementById('setting-folder');
  const autoUploadCheck = document.getElementById('setting-auto-upload');
  const saveGalleryCheck = document.getElementById('setting-save-gallery');

  if (urlInput) urlInput.value = state.seafileConfig.serverUrl || 'https://seafile.protutech.vip';
  if (tokenInput) tokenInput.value = '';
  if (folderInput) folderInput.value = state.seafileConfig.folder || '/';
  if (autoUploadCheck) autoUploadCheck.checked = state.seafileConfig.autoUpload;
  if (saveGalleryCheck) saveGalleryCheck.checked = state.seafileConfig.saveCopyToGallery !== false;

  renderDestinationUrlsList();

  modal.classList.add('active');

  if (options.focusDestinationUrls || options.focusDirectLinks) {
    document.getElementById('settings-destination-urls-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      document.getElementById('new-dest-url')?.focus();
    }, 150);
  }

  if (state.seafileConfig.hasToken && state.seafileConfig.serverUrl) {
    populateLibrarySelect();
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('modal-settings');
  if (modal) modal.classList.remove('active');
  const activeView = ['scanner', 'gallery'].includes(state.view) ? state.view : 'scanner';
  syncNavActiveState(activeView);
}

function collectDestinationUrlsFromUI() {
  const cards = document.querySelectorAll('#destination-urls-list .destination-url-card');
  const collected = [];
  cards.forEach((card, idx) => {
    const id = card.getAttribute('data-dest-id') || `dest_${Date.now()}_${idx}`;
    const name = card.querySelector('.dest-url-name-input')?.value.trim() || '';
    const url = card.querySelector('.dest-url-input')?.value.trim() || '';
    collected.push({ id, name, url });
  });
  return collected;
}

function renderDestinationUrlsList() {
  const container = document.getElementById('destination-urls-list');
  if (!container) return;

  container.innerHTML = '';
  if (!state.destinationUrls || state.destinationUrls.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'text-xs text-muted';
    emptyMsg.textContent = 'No destination URLs configured yet. Add a URL above to enable 1-tap sending.';
    container.appendChild(emptyMsg);
    return;
  }

  state.destinationUrls.forEach((dest, index) => {
    const card = document.createElement('div');
    card.className = 'preset-config-card destination-url-card';
    card.setAttribute('data-index', index);
    card.setAttribute('data-dest-id', dest.id || `dest_${index}`);

    card.innerHTML = `
      <div class="preset-card-row-top">
        <input type="text" class="form-control preset-name-input dest-url-name-input" value="${escapeHtml(dest.name || '')}" placeholder="Destination Name">
        <button type="button" class="btn btn-secondary btn-sm btn-save-dest-url" title="Save Destination URL">Save</button>
        <button type="button" class="btn-remove-preset btn-remove-dest-url" title="Remove Destination URL">Remove</button>
      </div>
      <div class="preset-card-row-bottom">
        <input type="url" class="form-control dest-url-input" style="flex: 1;" value="${escapeHtml(dest.url || '')}" placeholder="https://seafile.example.com/u/d/..." title="Destination URL">
      </div>
    `;

    const saveRowChanges = async (showFeedback = false) => {
      const updatedName = card.querySelector('.dest-url-name-input')?.value.trim() || '';
      const rawUrl = card.querySelector('.dest-url-input')?.value.trim() || '';
      const cleanUrl = (typeof StorageManager !== 'undefined' && typeof StorageManager.normalizeUrl === 'function')
        ? StorageManager.normalizeUrl(rawUrl)
        : rawUrl;
      if (!cleanUrl) {
        if (showFeedback) showToast('Destination URL cannot be empty.', 'warning');
        return;
      }
      const list = collectDestinationUrlsFromUI();
      list[index] = {
        id: dest.id || `dest_${Date.now()}_${index}`,
        name: updatedName || formatDestinationUrlSubtitle(cleanUrl),
        url: cleanUrl
      };
      await persistDestinationUrls(list);
      renderQuickDestinationPills();
      if (showFeedback) {
        renderDestinationUrlsList();
        showToast(`Saved "${list[index].name}".`, 'success');
      }
    };

    card.querySelector('.btn-save-dest-url')?.addEventListener('click', () => saveRowChanges(true));
    card.querySelector('.dest-url-name-input')?.addEventListener('change', () => saveRowChanges(false));
    card.querySelector('.dest-url-input')?.addEventListener('change', () => saveRowChanges(false));

    card.querySelector('.btn-remove-dest-url')?.addEventListener('click', async () => {
      const list = collectDestinationUrlsFromUI();
      list.splice(index, 1);
      await persistDestinationUrls(list);
      renderDestinationUrlsList();
      renderQuickDestinationPills();
      showToast('Removed destination URL.', 'info');
    });

    container.appendChild(card);
  });
}

async function handleAddDestinationUrl() {
  const nameInput = document.getElementById('new-dest-name');
  const urlInput = document.getElementById('new-dest-url');
  const rawUrl = urlInput?.value.trim() || '';
  const cleanUrl = (typeof StorageManager !== 'undefined' && typeof StorageManager.normalizeUrl === 'function')
    ? StorageManager.normalizeUrl(rawUrl)
    : rawUrl;

  if (!cleanUrl) {
    showToast('Please enter a destination URL.', 'warning');
    urlInput?.focus();
    return;
  }

  const rawName = nameInput?.value.trim() || '';
  const finalName = rawName || formatDestinationUrlSubtitle(cleanUrl) || `Destination ${state.destinationUrls.length + 1}`;

  const existing = document.querySelectorAll('#destination-urls-list .destination-url-card').length > 0
    ? collectDestinationUrlsFromUI()
    : [...(state.destinationUrls || [])];

  existing.push({
    id: 'dest_' + Date.now(),
    name: finalName,
    url: cleanUrl
  });

  await persistDestinationUrls(existing);
  if (nameInput) nameInput.value = '';
  if (urlInput) urlInput.value = '';

  renderDestinationUrlsList();
  renderQuickDestinationPills();
  showToast(`Added destination "${finalName}".`, 'success');
}

async function handleTestSeafileConnection() {
  const url = document.getElementById('setting-server-url')?.value.trim();
  const token = document.getElementById('setting-token')?.value.trim();

  if (!url) {
    showToast('Please enter your Seafile server URL', 'warning');
    return;
  }

  try {
    showLoading('Connecting to Seafile server...');
    const res = await SeafileApi.testConnection(url, token);
    hideLoading();
    showToast(`Connected. Logged in as ${res.account.email || res.account.name}`, 'success');
    populateLibrarySelectWithRepos(res.repos);
  } catch (err) {
    hideLoading();
    showToast('Connection failed: ' + err.message, 'error');
  }
}

async function handleSeafileLogin(e) {
  e.preventDefault();
  const url = document.getElementById('setting-server-url')?.value.trim();
  const user = document.getElementById('login-username')?.value.trim();
  const pass = document.getElementById('login-password')?.value;

  if (!url || !user || !pass) {
    showToast('Please enter server URL, username, and password.', 'warning');
    return;
  }

  try {
    showLoading('Authenticating with Seafile...');
    const res = await SeafileApi.login(url, user, pass);
    hideLoading();
    showToast(`Logged in as ${res.account.email}.`, 'success');
    state.seafileConfig.serverUrl = url;
    state.seafileConfig.hasToken = true;
    updateConnectionStatusUI();
    populateLibrarySelect();
  } catch (err) {
    hideLoading();
    showToast('Login failed: ' + err.message, 'error');
  }
}

async function populateLibrarySelect() {
  try {
    const repos = await SeafileApi.getRepos();
    populateLibrarySelectWithRepos(repos);
  } catch (err) {
    console.warn('Could not populate repos:', err);
  }
}

function populateLibrarySelectWithRepos(repos) {
  state.availableRepos = repos || [];
  const select = document.getElementById('setting-repo-select');
  if (select && repos) {
    select.innerHTML = '';
    repos.forEach(repo => {
      const opt = document.createElement('option');
      opt.value = repo.id;
      opt.textContent = `${repo.name} (${(repo.size / 1024 / 1024).toFixed(1)} MB)`;
      if (repo.id === state.seafileConfig.repoId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }
}

async function handleSaveSettings() {
  const url = document.getElementById('setting-server-url')?.value.trim();
  const token = document.getElementById('setting-token')?.value.trim();
  const folder = document.getElementById('setting-folder')?.value.trim() || '/';
  const repoSelect = document.getElementById('setting-repo-select');
  const repoId = repoSelect?.value || '';
  const repoName = repoSelect?.options[repoSelect.selectedIndex]?.text.split(' (')[0] || '';
  const autoUpload = document.getElementById('setting-auto-upload')?.checked;
  const saveCopyToGallery = document.getElementById('setting-save-gallery')?.checked !== false;
  if (typeof StorageManager !== 'undefined' && typeof StorageManager.saveSettings === 'function') {
    StorageManager.saveSettings({ saveCopyToGallery });
  }

  // Collect updated destination URLs (including any pending value in the add-URL inputs)
  const collectedLinks = collectDestinationUrlsFromUI();
  const pendingName = document.getElementById('new-dest-name')?.value.trim() || '';
  const pendingUrl = document.getElementById('new-dest-url')?.value.trim() || '';
  if (pendingUrl) {
    collectedLinks.push({
      id: 'dest_' + Date.now(),
      name: pendingName || formatDestinationUrlSubtitle(pendingUrl),
      url: pendingUrl
    });
  }

  const invalidLink = collectedLinks.find(l => l.name && !l.url);
  if (invalidLink) {
    showToast(`Please enter a URL for "${invalidLink.name}" or remove it.`, 'warning');
    return;
  }
  const savedLinks = await persistDestinationUrls(collectedLinks);
  if (pendingUrl) {
    const newNameEl = document.getElementById('new-dest-name');
    const newUrlEl = document.getElementById('new-dest-url');
    if (newNameEl) newNameEl.value = '';
    if (newUrlEl) newUrlEl.value = '';
  }

  try {
    showLoading('Saving settings...');
    const updated = await SeafileApi.saveConfig({
      serverUrl: url,
      token: token || undefined,
      repoId,
      repoName,
      folder,
      autoUpload,
      saveCopyToGallery,
      destinationUrls: savedLinks,
      directLinks: savedLinks
    });

    if (updated && updated.config) {
      const cleanUpdated = { ...updated.config };
      delete cleanUpdated.presets;
      state.seafileConfig = cleanUpdated;
    } else {
      state.seafileConfig = {
        ...state.seafileConfig,
        serverUrl: url || state.seafileConfig.serverUrl,
        repoId,
        repoName,
        folder,
        autoUpload,
        saveCopyToGallery,
        destinationUrls: savedLinks,
        directLinks: savedLinks
      };
    }
    hideLoading();
    closeSettingsModal();
    updateConnectionStatusUI();
    updateAutoSendUI();
    renderQuickDestinationPills();
    showToast('Settings and destination URLs saved.', 'success');
  } catch (err) {
    // Still update local state when offline / standalone without Node backend
    state.seafileConfig = {
      ...state.seafileConfig,
      serverUrl: url || state.seafileConfig.serverUrl,
      repoId,
      repoName,
      folder,
      autoUpload,
      saveCopyToGallery,
      destinationUrls: savedLinks,
      directLinks: savedLinks
    };
    hideLoading();
    closeSettingsModal();
    updateConnectionStatusUI();
    updateAutoSendUI();
    renderQuickDestinationPills();
    showToast('Settings saved locally.', 'success');
  }
}

// -------------------------------------------------------------
// Toast & Loading Helpers
// -------------------------------------------------------------
function showToast(msg, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const content = document.createElement('div');
  content.className = 'toast-content';
  content.innerHTML = msg;
  toast.appendChild(content);

  if (action && action.label) {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action-btn';
    actionBtn.innerHTML = action.label;
    actionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof action.onClick === 'function') {
        action.onClick();
      } else if (action.url) {
        window.open(action.url, '_blank');
      }
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);
  const duration = action ? 7000 : 3500;
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

function showLoading(text = 'Loading...') {
  const overlay = document.getElementById('loading-overlay');
  const label = document.getElementById('loading-text');
  if (label) label.textContent = text;
  if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'none';
}
