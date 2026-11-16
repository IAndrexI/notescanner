/**
 * RocketScan Main Application Controller
 */

// Default Rocketbook Quick-Send Destination Presets
const DEFAULT_PRESETS = [
  { id: 'notes', name: 'Notes', icon: '📁', repoId: '', repoName: '', folder: '/RocketScan/Notes' },
  { id: 'work', name: 'Work', icon: '💼', repoId: '', repoName: '', folder: '/RocketScan/Work' },
  { id: 'receipts', name: 'Receipts', icon: '🧾', repoId: '', repoName: '', folder: '/RocketScan/Receipts' },
  { id: 'journal', name: 'Journal', icon: '📓', repoId: '', repoName: '', folder: '/RocketScan/Journal' }
];

// Application State
const state = {
  view: 'scanner', // 'scanner' | 'crop' | 'filter' | 'gallery' | 'settings'
  capturedImage: null, // Image element of current raw capture
  corners: null, // [TL, TR, BR, BL] coordinates
  activeCornerIndex: null,
  activePageCanvas: null, // Flattened canvas of current page
  activeFilter: 'magic', // 'magic' | 'bw' | 'grayscale' | 'original'
  pages: [], // Array of { id, originalImage, corners, canvas, filter, rotation }
  documentTitle: '',
  seafileConfig: {
    serverUrl: '',
    hasToken: false,
    repoId: '',
    repoName: '',
    folder: '/RocketScan',
    autoUpload: true
  },
  presets: [...DEFAULT_PRESETS],
  availableRepos: [],
  networkInfo: null,
  seafileFiles: []
};

// Subsystem instances
const vision = new VisionEngine();
const storage = new StorageManager();
let cameraScanner = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  await storage.init();
  initUI();
  await loadConfigAndNetwork();
  initCamera();
  loadSeafileGallery();
});

// Load backend config & network info
async function loadConfigAndNetwork() {
  try {
    const [cfg, net] = await Promise.all([
      SeafileApi.getConfig(),
      SeafileApi.getNetworkInfo()
    ]);
    state.seafileConfig = cfg;
    state.networkInfo = net;

    // Load presets from server, fallback to localStorage, fallback to DEFAULT_PRESETS
    if (cfg.presets && Array.isArray(cfg.presets) && cfg.presets.length > 0) {
      state.presets = cfg.presets;
    } else {
      const stored = localStorage.getItem('rocketscan_presets');
      if (stored) {
        try {
          state.presets = JSON.parse(stored);
        } catch (e) {
          state.presets = [...DEFAULT_PRESETS];
        }
      } else {
        state.presets = [...DEFAULT_PRESETS];
      }
    }

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
    finishBtnText.textContent = isAuto ? '⚡ 1-Tap Auto-Send to Seafile' : 'Save & Seafile Backup';
  }
}

async function handleToggleAutoSend(e) {
  const enabled = e.target.checked;
  state.seafileConfig.autoUpload = enabled;
  updateAutoSendUI();
  try {
    await SeafileApi.saveConfig({ autoUpload: enabled });
    showToast(enabled ? '⚡ 1-Tap Auto-Send enabled' : '1-Tap Auto-Send turned off', 'info');
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
    badge.innerHTML = `<span class="dot"></span> Seafile: Connected (${state.seafileConfig.repoName || 'Library selected'})`;
  } else {
    badge.className = 'status-badge disconnected';
    badge.innerHTML = `<span class="dot"></span> Seafile: Setup Required`;
  }
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
    if (fallbackCard) fallbackCard.style.display = 'block';
    if (directBtn) directBtn.style.display = 'flex';
    showToast('Live camera paused or unavailable. Tap "Capture with Camera" for native photo shutter.', 'info');
  }
}

// UI Event Handlers & View Navigation
function initUI() {
  // Navigation tabs
  document.getElementById('nav-scanner')?.addEventListener('click', () => switchView('scanner'));
  document.getElementById('nav-gallery')?.addEventListener('click', () => {
    switchView('gallery');
    loadSeafileGallery();
  });
  document.getElementById('nav-settings')?.addEventListener('click', () => openSettingsModal());

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
  document.getElementById('btn-add-page')?.addEventListener('click', handleAddAnotherPage);
  document.getElementById('btn-finish-doc')?.addEventListener('click', handleFinishDoc);
  document.getElementById('btn-filter-back')?.addEventListener('click', () => switchView('crop'));

  // Multi-format Export Dropdown on Review Screen
  const exportDropdownBtn = document.getElementById('btn-export-dropdown');
  const exportDropdownMenu = document.getElementById('export-dropdown-menu');
  if (exportDropdownBtn && exportDropdownMenu) {
    exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdownMenu.classList.toggle('show');
    });

    document.querySelectorAll('#export-dropdown-menu .dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        exportDropdownMenu.classList.remove('show');
        const format = e.currentTarget.dataset.export;
        if (format === 'share') {
          handleWebShareCurrentDocument();
        } else if (format === 'qr') {
          handleOpenQrShareForCurrent();
        } else {
          handleDownloadExport(format);
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!exportDropdownBtn.contains(e.target)) {
        exportDropdownMenu.classList.remove('show');
      }
    });
  }

  // Quick-Send Auto-Send Toggle
  document.getElementById('review-auto-send-toggle')?.addEventListener('change', handleToggleAutoSend);

  // Document Save modal
  document.getElementById('btn-cancel-save')?.addEventListener('click', closeSaveDocModal);
  document.getElementById('btn-upload-seafile')?.addEventListener('click', handleUploadToSeafile);
  document.getElementById('btn-download-pdf')?.addEventListener('click', handleDownloadLocalPdf);
  document.getElementById('btn-share-modal')?.addEventListener('click', () => {
    const fmt = document.getElementById('save-format-select')?.value || 'pdf';
    handleWebShareCurrentDocument(fmt);
  });
  document.getElementById('btn-qr-share-modal')?.addEventListener('click', () => {
    handleOpenQrShareForCurrent();
  });

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
  document.getElementById('btn-add-preset')?.addEventListener('click', handleAddPreset);

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('active');
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

function switchView(viewName) {
  state.view = viewName;
  document.querySelectorAll('.view-screen').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

  const targetScreen = document.getElementById(`view-${viewName}`);
  if (targetScreen) targetScreen.classList.add('active');

  const navTab = document.getElementById(`nav-${viewName}`);
  if (navTab) navTab.classList.add('active');

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

function handleAddAnotherPage() {
  if (!state.activePageCanvas) return;

  // Save current page to batch
  state.pages.push({
    id: Date.now(),
    canvas: state.activePageCanvas,
    filter: state.activeFilter
  });

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
  if (state.seafileConfig.autoUpload) {
    // 1-Tap Auto-Send: instantly upload to default library/folder
    handleUploadToSeafile();
  } else {
    // Open modal for preview, title edit, download, etc.
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

// Render Rocketbook-style Quick Destination Pills (both on review view and in save modal)
function renderQuickDestinationPills() {
  const containers = [
    document.getElementById('quick-dest-pills'),
    document.getElementById('modal-quick-dest-pills')
  ];

  containers.forEach(container => {
    if (!container) return;
    container.innerHTML = '';

    state.presets.forEach(preset => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'dest-pill';
      pill.title = `1-Tap Send to ${preset.name} (${preset.folder})`;
      pill.setAttribute('data-preset-id', preset.id);

      const folderName = preset.folder.split('/').filter(Boolean).pop() || preset.folder;
      pill.innerHTML = `
        <span class="dest-pill-icon">${preset.icon || '📁'}</span>
        <span class="dest-pill-name">${preset.name}</span>
        <span class="dest-pill-folder">/${folderName}</span>
      `;

      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleQuickSend(preset);
      });

      container.appendChild(pill);
    });
  });
}

// 1-Tap Quick-Send to destination preset with zero extra clicks
async function handleQuickSend(preset) {
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

  const targetRepoId = preset.repoId || state.seafileConfig.repoId;
  const targetFolder = preset.folder || state.seafileConfig.folder || '/RocketScan';

  if (!targetRepoId) {
    showToast('Please select a target Seafile library in Settings first.', 'warning');
    openSettingsModal();
    return;
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
    const sanitizedName = preset.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const fileName = `${sanitizedName}_${dateStr}_${timeStr}.pdf`;

    showToast(`🚀 Quick-sending to ${preset.icon} ${preset.name} (${targetFolder})...`, 'info');
    showLoading(`Compiling PDF & 1-tap sending to ${preset.name}...`);

    const pdfBlob = await PdfBuilder.createPdfFromPages(state.pages);

    const uploadRes = await SeafileApi.uploadFile(
      pdfBlob,
      fileName,
      targetRepoId,
      targetFolder
    );

    hideLoading();
    closeSaveDocModal();

    const cleanFolder = targetFolder.replace(/^\/+|\/+$/g, '');
    const cleanPath = cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
    const viewUrl = uploadRes.viewUrl || (state.seafileConfig.serverUrl ? `${state.seafileConfig.serverUrl.replace(/\/+$/, '')}/#common/lib/${targetRepoId}/${encodeURIComponent(cleanPath)}` : '');

    // Immediate visual feedback toast with link/button to view in Seafile
    showToast(`✓ Uploaded "${fileName}" to ${preset.icon} ${preset.name}!`, 'success', {
      label: '👁️ View in Seafile',
      onClick: async () => {
        try {
          const directUrl = await SeafileApi.getFileUrl(targetRepoId, `/${cleanPath}`);
          if (directUrl) {
            window.open(directUrl, '_blank');
            return;
          }
        } catch (e) {}
        if (viewUrl) {
          window.open(viewUrl, '_blank');
        }
      }
    });

    // Reset current batch for next scan
    state.pages = [];
    state.activePageCanvas = null;
    updatePageBadge();

    // Refresh Seafile gallery in background
    loadSeafileGallery().catch(() => {});
  } catch (err) {
    hideLoading();
    showToast('Upload error: ' + err.message, 'error');
  }
}

async function handleDownloadExport(format = 'pdf', options = {}) {
  try {
    const fmt = format.toUpperCase();
    showLoading(`Exporting document as ${fmt}...`);
    const title = (document.getElementById('save-doc-title')?.value || 'Scanned_Notes').trim();

    // Ensure active page is included if state.pages is empty
    let pagesToExport = [...state.pages];
    if (state.activePageCanvas && pagesToExport.length === 0) {
      pagesToExport.push({
        id: Date.now(),
        canvas: state.activePageCanvas,
        filter: state.activeFilter
      });
    }

    if (pagesToExport.length === 0) {
      hideLoading();
      showToast('No pages available to export', 'warning');
      return;
    }

    const result = await ExportManager.downloadDocument(pagesToExport, format, {
      title,
      pageSize: options.pageSize || 'a4',
      orientation: options.orientation || 'auto',
      quality: options.quality || 0.90,
      ...options
    });

    hideLoading();
    showToast(`Exported ${result.filename} successfully!`, 'success');
    return result;
  } catch (err) {
    hideLoading();
    showToast(`Failed to export ${format}: ${err.message}`, 'error');
    console.error('Export error:', err);
  }
}

async function handleDownloadLocalPdf() {
  const fmt = document.getElementById('save-format-select')?.value || 'pdf';
  return handleDownloadExport(fmt);
}
window.handleDownloadExport = handleDownloadExport;

// -------------------------------------------------------------
// Direct Sharing to People & Devices (Web Share API & QR Code)
// -------------------------------------------------------------
async function handleWebShareCurrentDocument(format = 'pdf') {
  try {
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
      showToast('Please scan at least one page first.', 'info');
      return;
    }

    const title = (document.getElementById('save-doc-title')?.value || 'Scanned_Notes').trim();
    showLoading(`Preparing ${format.toUpperCase()} for sharing...`);

    const result = await ExportManager.exportDocument(state.pages, format, { title });
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
        text: `RocketScan: ${title}`
      });
      showToast('Shared via system share!', 'success');
      return;
    }

    // Fallback: Open QR share modal
    openQrShareModal({
      title: result.filename,
      info: 'AirDrop / Web Share file sharing is not supported in this browser. Use QR code or download directly.'
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
    showToast('✓ Share link copied to clipboard!', 'success');
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
  const targetFolder = state.seafileConfig.folder || '/RocketScan';

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

    hideLoading();
    closeSaveDocModal();

    const cleanFolder = targetFolder.replace(/^\/+|\/+$/g, '');
    const cleanPath = cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
    const viewUrl = uploadRes.viewUrl || (state.seafileConfig.serverUrl ? `${state.seafileConfig.serverUrl.replace(/\/+$/, '')}/#common/lib/${targetRepoId}/${encodeURIComponent(cleanPath)}` : '');

    // Immediate visual feedback toast with link/button to view in Seafile & Share link
    showToast(`✓ Uploaded "${fileName}" to Seafile!`, 'success', {
      label: '🔗 Get Share Link',
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
            showToast(`📋 Public link copied: ${shareUrl}`, 'success', {
              label: '🌐 Open URL',
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

    files.forEach(file => {
      const card = document.createElement('div');
      card.className = 'note-card';

      const dateStr = file.mtime ? new Date(file.mtime * 1000).toLocaleString() : '';
      const sizeStr = file.size ? `${(file.size / 1024).toFixed(1)} KB` : '';

      card.innerHTML = `
        <div class="note-card-icon">
          ${file.isPdf ? '📄' : '🖼️'}
        </div>
        <div class="note-card-body">
          <div class="note-card-title" title="${file.name}">${file.name}</div>
          <div class="note-card-meta">${dateStr} • ${sizeStr}</div>
        </div>
        <div class="note-card-actions">
          <button class="btn-icon btn-open-note" data-path="${file.fullPath}" title="View / Download">
            👁️ Open
          </button>
          <button class="btn-icon btn-share-note" data-path="${file.fullPath}" title="Generate & Copy Public Share Link">
            🔗 Link
          </button>
          <button class="btn-icon btn-qr-note" data-path="${file.fullPath}" title="Scan QR Code to Download on Phone">
            📲 QR
          </button>
          ${navigator.share ? `
          <button class="btn-icon btn-webshare-note" data-path="${file.fullPath}" title="Share via AirDrop, WhatsApp, Slack">
            📤 Share
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
        <p class="text-sm">${err.message}</p>
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
      showToast(`✓ Public share link copied to clipboard!`, 'success', {
        label: '🌐 Open URL',
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
        <strong>✓ Healthy Seafile Connection</strong><br>
        <span>Latency: <strong>${health.latencyMs}ms</strong></span> • 
        <span>User: <strong>${health.account?.email || health.account?.name || 'Authenticated'}</strong></span><br>
        <span>Active Library: <strong>${health.activeRepoName || health.libraryInfo?.activeRepoName || 'Auto-selected'}</strong> (${health.libraryInfo?.totalLibraries || 0} total)</span>
      `;
    } else {
      detailsBox.className = 'health-status-box unhealthy';
      detailsBox.innerHTML = `
        <strong>⚠️ Connection Issue</strong><br>
        <span>Status: ${health.status || 'Unhealthy'}</span><br>
        <span class="text-xs">${health.error || health.message || 'Check URL and token.'}</span>
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
function openSettingsModal() {
  const modal = document.getElementById('modal-settings');
  if (!modal) return;

  const urlInput = document.getElementById('setting-server-url');
  const tokenInput = document.getElementById('setting-token');
  const folderInput = document.getElementById('setting-folder');
  const autoUploadCheck = document.getElementById('setting-auto-upload');

  if (urlInput) urlInput.value = state.seafileConfig.serverUrl || '';
  if (tokenInput) tokenInput.value = '';
  if (folderInput) folderInput.value = state.seafileConfig.folder || '/RocketScan';
  if (autoUploadCheck) autoUploadCheck.checked = state.seafileConfig.autoUpload;

  renderPresetsSettingsList();

  modal.classList.add('active');

  if (state.seafileConfig.hasToken && state.seafileConfig.serverUrl) {
    populateLibrarySelect();
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('modal-settings');
  if (modal) modal.classList.remove('active');
}

// Render the customizable presets list in the Settings modal
function renderPresetsSettingsList() {
  const container = document.getElementById('presets-config-list');
  if (!container) return;

  container.innerHTML = '';
  state.presets.forEach((preset, index) => {
    const card = document.createElement('div');
    card.className = 'preset-config-card';
    card.setAttribute('data-index', index);

    // Build repo options
    let repoOptions = `<option value="">(Default: ${state.seafileConfig.repoName || 'Primary Library'})</option>`;
    if (state.availableRepos && state.availableRepos.length > 0) {
      state.availableRepos.forEach(repo => {
        const isSelected = (preset.repoId === repo.id) ? 'selected' : '';
        repoOptions += `<option value="${repo.id}" ${isSelected}>${repo.name}</option>`;
      });
    }

    card.innerHTML = `
      <div class="preset-card-row-top">
        <input type="text" class="form-control preset-icon-input" value="${preset.icon || '📁'}" maxlength="4" title="Badge Emoji">
        <input type="text" class="form-control preset-name-input" value="${preset.name || ''}" placeholder="Preset Label (e.g. Notes, Work)">
        <button type="button" class="btn-remove-preset" title="Delete Preset" ${state.presets.length <= 1 ? 'disabled style="opacity:0.4"' : ''}>🗑️</button>
      </div>
      <div class="preset-card-row-bottom">
        <select class="form-control preset-repo-select" title="Target Library">
          ${repoOptions}
        </select>
        <input type="text" class="form-control preset-folder-input" value="${preset.folder || '/RocketScan'}" placeholder="/RocketScan/Folder" title="Destination Subfolder">
      </div>
    `;

    card.querySelector('.btn-remove-preset')?.addEventListener('click', () => {
      if (state.presets.length > 1) {
        state.presets.splice(index, 1);
        renderPresetsSettingsList();
      }
    });

    container.appendChild(card);
  });
}

function handleAddPreset() {
  const emojis = ['📚', '🏷️', '📦', '💡', '🎨', '🔖'];
  const nextEmoji = emojis[state.presets.length % emojis.length];
  state.presets.push({
    id: 'preset_' + Date.now(),
    name: `Custom ${state.presets.length + 1}`,
    icon: nextEmoji,
    repoId: '',
    repoName: '',
    folder: `/RocketScan/Custom`
  });
  renderPresetsSettingsList();
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
    showToast(`✓ Connected! Logged in as ${res.account.email || res.account.name}`, 'success');
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
    showToast(`✓ Logged in as ${res.account.email}!`, 'success');
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
  // Refresh preset dropdowns with newly loaded repos
  renderPresetsSettingsList();
}

async function handleSaveSettings() {
  const url = document.getElementById('setting-server-url')?.value.trim();
  const token = document.getElementById('setting-token')?.value.trim();
  const folder = document.getElementById('setting-folder')?.value.trim() || '/RocketScan';
  const repoSelect = document.getElementById('setting-repo-select');
  const repoId = repoSelect?.value || '';
  const repoName = repoSelect?.options[repoSelect.selectedIndex]?.text.split(' (')[0] || '';
  const autoUpload = document.getElementById('setting-auto-upload')?.checked;

  // Collect updated presets from config cards
  const presetCards = document.querySelectorAll('#presets-config-list .preset-config-card');
  const updatedPresets = [];
  presetCards.forEach((card, idx) => {
    const icon = card.querySelector('.preset-icon-input')?.value.trim() || '📁';
    const name = card.querySelector('.preset-name-input')?.value.trim() || `Preset ${idx + 1}`;
    const repoSel = card.querySelector('.preset-repo-select');
    const selectedRepoId = repoSel?.value || '';
    const selectedRepoName = selectedRepoId && repoSel?.options[repoSel.selectedIndex]
      ? repoSel.options[repoSel.selectedIndex].text.split(' (')[0]
      : '';
    const folderVal = card.querySelector('.preset-folder-input')?.value.trim() || '/RocketScan';

    updatedPresets.push({
      id: state.presets[idx]?.id || ('preset_' + idx),
      name,
      icon,
      repoId: selectedRepoId,
      repoName: selectedRepoName,
      folder: folderVal.startsWith('/') ? folderVal : `/${folderVal}`
    });
  });

  if (updatedPresets.length > 0) {
    state.presets = updatedPresets;
  }
  localStorage.setItem('rocketscan_presets', JSON.stringify(state.presets));

  try {
    showLoading('Saving settings...');
    const updated = await SeafileApi.saveConfig({
      serverUrl: url,
      token: token || undefined,
      repoId,
      repoName,
      folder,
      autoUpload,
      presets: state.presets
    });

    state.seafileConfig = updated.config;
    hideLoading();
    closeSettingsModal();
    updateConnectionStatusUI();
    updateAutoSendUI();
    renderQuickDestinationPills();
    showToast('✓ Settings & destination presets saved!', 'success');
  } catch (err) {
    hideLoading();
    showToast('Save failed: ' + err.message, 'error');
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
