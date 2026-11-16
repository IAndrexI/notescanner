/**
 * CameraScanner: Manages live camera stream, torch control,
 * real-time viewfinder guides, capture, gallery image imports,
 * and robust Apple / iOS Safari camera permission & rear-lens selection.
 */
class CameraScanner {
  constructor(videoElement, canvasOverlay, options = {}) {
    this.video = videoElement;
    this.overlay = canvasOverlay;
    this.overlayCtx = canvasOverlay ? canvasOverlay.getContext('2d') : null;
    this.stream = null;
    this.torchEnabled = false;
    this.hasTorch = false;
    this.onFrameCallback = options.onFrame || null;
    this.animationId = null;
    this.isActive = false;

    // Apply critical iOS Safari video playback attributes
    if (this.video) {
      this.video.setAttribute('playsinline', 'true');
      this.video.setAttribute('webkit-playsinline', 'true');
      this.video.setAttribute('autoplay', 'true');
      this.video.setAttribute('muted', 'true');
      this.video.muted = true;
    }
  }

  /**
   * Helper to identify Apple iOS devices (iPhone, iPad, iPod, or iPadOS desktop UA)
   */
  static isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /**
   * Enumerate video input devices to find the primary rear/back lens
   */
  async getRearCameraDeviceId() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (videoDevices.length <= 1) return null;

      // Prefer back/rear/environment camera (avoiding ultra-wide lens if specifically labeled)
      const primaryRear = videoDevices.find(d => {
        const label = (d.label || '').toLowerCase();
        return (label.includes('back') || label.includes('rear') || label.includes('environment')) &&
               !label.includes('wide') && !label.includes('0.5x') && !label.includes('tele');
      }) || videoDevices.find(d => {
        const label = (d.label || '').toLowerCase();
        return label.includes('back') || label.includes('rear') || label.includes('environment');
      });

      return primaryRear ? primaryRear.deviceId : null;
    } catch (e) {
      console.warn('[CameraScanner] Device enumeration notice:', e.message);
      return null;
    }
  }

  /**
   * Start rear camera with multi-stage iOS-resilient fallback
   */
  async start() {
    try {
      this.stop();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API (getUserMedia) not supported in this browser.');
      }

      const rearDeviceId = await this.getRearCameraDeviceId();

      // Progressive constraint tiers: starting from ideal high-res down to basic video
      const constraintAttempts = [
        // Tier 1: Target rear camera deviceId or ideal environment with 1080p
        rearDeviceId ? {
          audio: false,
          video: {
            deviceId: { exact: rearDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        } : {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        },
        // Tier 2: Ideal environment without resolution requirements (iOS Safari friendly)
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' }
          }
        },
        // Tier 3: Direct environment constraint
        {
          audio: false,
          video: {
            facingMode: 'environment'
          }
        },
        // Tier 4: Generic video (handles front camera or desktop webcams)
        {
          audio: false,
          video: true
        }
      ];

      let lastError = null;
      for (const constraints of constraintAttempts) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          this.video.srcObject = this.stream;

          // Re-assert inline playback attributes for iOS Safari
          this.video.setAttribute('playsinline', 'true');
          this.video.setAttribute('webkit-playsinline', 'true');
          this.video.muted = true;

          await this.video.play();
          this.isActive = true;

          // Check if torch/flash is supported by the camera track
          const track = this.getVideoTrack();
          if (track) {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            this.hasTorch = Boolean(capabilities.torch);
          }

          this.startOverlayLoop();
          return { success: true, hasTorch: this.hasTorch, isIOS: CameraScanner.isIOS() };
        } catch (attemptErr) {
          lastError = attemptErr;
          console.warn('[CameraScanner] Attempt constraint tier failed:', attemptErr.name || attemptErr.message);
          if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
          }
        }
      }

      throw lastError || new Error('Could not initialize camera stream');
    } catch (err) {
      console.warn('[CameraScanner] Camera start error:', err);
      throw new Error('Camera access denied or unavailable: ' + (err.message || 'Permission denied'));
    }
  }

  getVideoTrack() {
    return this.stream ? this.stream.getVideoTracks()[0] : null;
  }

  // Toggle flashlight / torch
  async toggleTorch() {
    const track = this.getVideoTrack();
    if (!track || !this.hasTorch) return false;

    try {
      this.torchEnabled = !this.torchEnabled;
      await track.applyConstraints({
        advanced: [{ torch: this.torchEnabled }]
      });
      return this.torchEnabled;
    } catch (err) {
      console.error('[CameraScanner] Torch error:', err);
      return false;
    }
  }

  stop() {
    this.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  startOverlayLoop() {
    const render = () => {
      if (!this.isActive) return;

      if (this.overlay && this.overlayCtx && this.video.videoWidth > 0) {
        if (this.overlay.width !== this.video.clientWidth || this.overlay.height !== this.video.clientHeight) {
          this.overlay.width = this.video.clientWidth;
          this.overlay.height = this.video.clientHeight;
        }

        const w = this.overlay.width;
        const h = this.overlay.height;
        this.overlayCtx.clearRect(0, 0, w, h);

        // Draw subtle viewfinder brackets (Rocketbook-inspired framing)
        const padX = w * 0.08;
        const padY = h * 0.08;
        const rectW = w - padX * 2;
        const rectH = h - padY * 2;
        const cornerLen = Math.min(rectW, rectH) * 0.12;

        this.overlayCtx.lineWidth = 3;
        this.overlayCtx.strokeStyle = 'rgba(59, 130, 246, 0.85)'; // Blue tint

        // TL corner
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(padX, padY + cornerLen);
        this.overlayCtx.lineTo(padX, padY);
        this.overlayCtx.lineTo(padX + cornerLen, padY);

        // TR corner
        this.overlayCtx.moveTo(w - padX - cornerLen, padY);
        this.overlayCtx.lineTo(w - padX, padY);
        this.overlayCtx.lineTo(w - padX, padY + cornerLen);

        // BR corner
        this.overlayCtx.moveTo(w - padX, h - padY - cornerLen);
        this.overlayCtx.lineTo(w - padX, h - padY);
        this.overlayCtx.lineTo(w - padX - cornerLen, h - padY);

        // BL corner
        this.overlayCtx.moveTo(padX + cornerLen, h - padY);
        this.overlayCtx.lineTo(padX, h - padY);
        this.overlayCtx.lineTo(padX, h - padY - cornerLen);
        this.overlayCtx.stroke();
      }

      this.animationId = requestAnimationFrame(render);
    };

    this.animationId = requestAnimationFrame(render);
  }

  // Capture a still frame from the video stream at native camera resolution
  captureFrame() {
    if (!this.video || this.video.videoWidth === 0) {
      throw new Error('Video stream is not ready for capture');
    }

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, vw, vh);

    return canvas;
  }
}

window.CameraScanner = CameraScanner;
