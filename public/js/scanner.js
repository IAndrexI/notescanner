/**
 * CameraScanner: Manages live camera stream, torch control,
 * real-time viewfinder guides, capture, and gallery image imports.
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
  }

  // Start back camera
  async start() {
    try {
      this.stop();

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 }
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      this.isActive = true;

      // Check if torch/flash is supported by the camera track
      const track = this.getVideoTrack();
      if (track) {
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        this.hasTorch = Boolean(capabilities.torch);
      }

      this.startOverlayLoop();
      return { success: true, hasTorch: this.hasTorch };
    } catch (err) {
      console.warn('Camera start error:', err);
      // Fallback without strict resolution constraints
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.isActive = true;
        this.startOverlayLoop();
        return { success: true, hasTorch: false };
      } catch (fallbackErr) {
        throw new Error('Camera access denied or unavailable: ' + fallbackErr.message);
      }
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
      console.error('Torch error:', err);
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
