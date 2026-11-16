/**
 * VisionEngine: High-Performance Computer Vision for Document Scanning,
 * Corner Snapping, Perspective Transformation, and Authentic Rocketbook Filters.
 *
 * Upgrades:
 * - Flat-field illumination normalization using large-kernel background estimation
 *   to eliminate desk shadows, ambient gradients, and paper yellowing.
 * - Laplacian edge enhancement / unsharp mask filtering for razor-sharp handwritten ink.
 * - Intelligent color saturation boost for blue, black, red, and green pen inks
 *   while locking the notebook page to pure #FFFFFF white.
 * - Enhanced B&W adaptive thresholding (Bradley-Roth) and grayscale modes.
 */
class VisionEngine {
  constructor() {
    if (typeof document !== 'undefined') {
      this.cachedCanvas = document.createElement('canvas');
      this.cachedCtx = this.cachedCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  // Distance between two 2D points
  static dist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  // Sort 4 arbitrary points into [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
  static orderCorners(points) {
    if (!points || points.length !== 4) return points;

    // Find center
    const cx = points.reduce((acc, p) => acc + p.x, 0) / 4;
    const cy = points.reduce((acc, p) => acc + p.y, 0) / 4;

    // Find corners using coordinate sums and differences
    let tlIndex = 0;
    let minSum = Infinity;
    points.forEach((p, idx) => {
      const sum = p.x + p.y;
      if (sum < minSum) {
        minSum = sum;
        tlIndex = idx;
      }
    });

    let brIndex = 0;
    let maxSum = -Infinity;
    points.forEach((p, idx) => {
      const sum = p.x + p.y;
      if (sum > maxSum) {
        maxSum = sum;
        brIndex = idx;
      }
    });

    let trIndex = 0;
    let maxDiff = -Infinity;
    points.forEach((p, idx) => {
      const diff = p.x - p.y;
      if (diff > maxDiff) {
        maxDiff = diff;
        trIndex = idx;
      }
    });

    let blIndex = 0;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const diff = p.x - p.y;
      if (diff < minDiff) {
        minDiff = diff;
        blIndex = idx;
      }
    });

    return [
      { ...points[tlIndex] }, // TL
      { ...points[trIndex] }, // TR
      { ...points[brIndex] }, // BR
      { ...points[blIndex] }  // BL
    ];
  }

  // Auto-detect document quad edges in an image or video frame
  detectDocumentEdges(imageElement, options = {}) {
    const origW = imageElement.videoWidth || imageElement.naturalWidth || imageElement.width;
    const origH = imageElement.videoHeight || imageElement.naturalHeight || imageElement.height;

    if (!origW || !origH) {
      return this.getDefaultCorners(100, 100);
    }

    // Process on a small scale for instant 60fps performance
    const scale = Math.min(1.0, 360 / Math.max(origW, origH));
    const sw = Math.round(origW * scale);
    const sh = Math.round(origH * scale);

    this.cachedCanvas.width = sw;
    this.cachedCanvas.height = sh;
    this.cachedCtx.drawImage(imageElement, 0, 0, sw, sh);

    const imgData = this.cachedCtx.getImageData(0, 0, sw, sh);
    const d = imgData.data;

    // 1. Grayscale & Luminance
    const gray = new Uint8Array(sw * sh);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }

    // 2. Sobel gradient / edge energy map
    const edges = new Uint8Array(sw * sh);
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const idx = y * sw + x;
        const gx =
          -gray[idx - sw - 1] + gray[idx - sw + 1]
          -2 * gray[idx - 1] + 2 * gray[idx + 1]
          -gray[idx + sw - 1] + gray[idx + sw + 1];
        const gy =
          -gray[idx - sw - 1] - 2 * gray[idx - sw] - gray[idx - sw + 1]
          +gray[idx + sw - 1] + 2 * gray[idx + sw] + gray[idx + sw + 1];
        edges[idx] = Math.min(255, (Math.abs(gx) + Math.abs(gy)) >> 1);
      }
    }

    // 3. Scan outwards along rays from center to locate candidate paper boundaries
    const cx = sw / 2;
    const cy = sh / 2;
    const angles = [
      Math.PI * 1.25, // TL (-135 deg)
      Math.PI * 1.75, // TR (-45 deg)
      Math.PI * 0.25, // BR (45 deg)
      Math.PI * 0.75  // BL (135 deg)
    ];

    const corners = angles.map((ang) => {
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      let bestR = Math.min(sw, sh) * 0.42;
      let maxGrad = 0;

      const maxR = Math.min(
        cosA > 0 ? (sw - cx - 10) / cosA : (-cx + 10) / cosA,
        sinA > 0 ? (sh - cy - 10) / sinA : (-cy + 10) / sinA
      );

      for (let r = Math.min(sw, sh) * 0.15; r < maxR; r += 2) {
        const px = Math.round(cx + r * cosA);
        const py = Math.round(cy + r * sinA);
        if (px > 2 && px < sw - 2 && py > 2 && py < sh - 2) {
          const grad = edges[py * sw + px];
          if (grad > maxGrad && grad > 35) {
            maxGrad = grad;
            bestR = r;
          }
        }
      }

      return {
        x: (cx + bestR * cosA) / scale,
        y: (cy + bestR * sinA) / scale
      };
    });

    const ordered = VisionEngine.orderCorners(corners);

    // Sanity check: Ensure quad area is reasonable, otherwise use standard inset
    const approxW = (VisionEngine.dist(ordered[0], ordered[1]) + VisionEngine.dist(ordered[3], ordered[2])) / 2;
    const approxH = (VisionEngine.dist(ordered[0], ordered[3]) + VisionEngine.dist(ordered[1], ordered[2])) / 2;
    if (approxW < origW * 0.3 || approxH < origH * 0.3) {
      return this.getDefaultCorners(origW, origH);
    }

    return ordered;
  }

  // Default inset corners (8% padding from borders)
  getDefaultCorners(width, height) {
    const padX = width * 0.08;
    const padY = height * 0.08;
    return [
      { x: padX, y: padY },
      { x: width - padX, y: padY },
      { x: width - padX, y: height - padY },
      { x: padX, y: height - padY }
    ];
  }

  // Perspective Warp: Project arbitrary 4-corner quad into a flat rectangle
  warpPerspective(sourceImage, corners, options = {}) {
    const ordered = VisionEngine.orderCorners(corners);
    const [tl, tr, br, bl] = ordered;

    // Calculate dimensions of the output rectangular document
    const topW = VisionEngine.dist(tl, tr);
    const botW = VisionEngine.dist(bl, br);
    const leftH = VisionEngine.dist(tl, bl);
    const rightH = VisionEngine.dist(tr, br);

    let dstW = Math.round(Math.max(topW, botW));
    let dstH = Math.round(Math.max(leftH, rightH));

    // Cap maximum resolution for snappy performance while preserving crisp text
    const maxDim = options.maxDimension || 2048;
    if (Math.max(dstW, dstH) > maxDim) {
      const scale = maxDim / Math.max(dstW, dstH);
      dstW = Math.round(dstW * scale);
      dstH = Math.round(dstH * scale);
    }

    // Source canvas
    const srcCanvas = document.createElement('canvas');
    const srcW = sourceImage.naturalWidth || sourceImage.videoWidth || sourceImage.width;
    const srcH = sourceImage.naturalHeight || sourceImage.videoHeight || sourceImage.height;
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    srcCtx.drawImage(sourceImage, 0, 0);

    const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
    const sPixels = srcData.data;

    // Target output canvas
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = dstW;
    dstCanvas.height = dstH;
    const dstCtx = dstCanvas.getContext('2d');
    const dstData = dstCtx.createImageData(dstW, dstH);
    const dPixels = dstData.data;

    // Solve for 3x3 Inverse Homography matrix mapping (dstX, dstY) -> (srcX, srcY)
    const Hinv = this.computeInverseHomography(
      [tl, tr, br, bl],
      [
        { x: 0, y: 0 },
        { x: dstW, y: 0 },
        { x: dstW, y: dstH },
        { x: 0, y: dstH }
      ]
    );

    // Backward mapping with bilinear interpolation
    for (let y = 0; y < dstH; y++) {
      const rowOffset = y * dstW * 4;
      for (let x = 0; x < dstW; x++) {
        // Project (x, y) into source coordinates
        const den = Hinv[6] * x + Hinv[7] * y + Hinv[8];
        const sx = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / den;
        const sy = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / den;

        const outIdx = rowOffset + (x * 4);

        if (sx >= 0 && sx < srcW - 1 && sy >= 0 && sy < srcH - 1) {
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const dx = sx - x0;
          const dy = sy - y0;
          const w00 = (1 - dx) * (1 - dy);
          const w10 = dx * (1 - dy);
          const w01 = (1 - dx) * dy;
          const w11 = dx * dy;

          const i00 = (y0 * srcW + x0) * 4;
          const i10 = (y0 * srcW + x1) * 4;
          const i01 = (y1 * srcW + x0) * 4;
          const i11 = (y1 * srcW + x1) * 4;

          dPixels[outIdx]     = w00 * sPixels[i00]     + w10 * sPixels[i10]     + w01 * sPixels[i01]     + w11 * sPixels[i11];
          dPixels[outIdx + 1] = w00 * sPixels[i00 + 1] + w10 * sPixels[i10 + 1] + w01 * sPixels[i01 + 1] + w11 * sPixels[i11 + 1];
          dPixels[outIdx + 2] = w00 * sPixels[i00 + 2] + w10 * sPixels[i10 + 2] + w01 * sPixels[i01 + 2] + w11 * sPixels[i11 + 2];
          dPixels[outIdx + 3] = 255;
        } else {
          dPixels[outIdx] = 255;
          dPixels[outIdx + 1] = 255;
          dPixels[outIdx + 2] = 255;
          dPixels[outIdx + 3] = 255;
        }
      }
    }

    dstCtx.putImageData(dstData, 0, 0);
    return dstCanvas;
  }

  // Compute inverse homography matrix
  computeInverseHomography(srcPts, dstPts) {
    return this.getPerspectiveTransformMatrix(dstPts, srcPts);
  }

  // Solves for 8 degrees of freedom projective transform
  getPerspectiveTransformMatrix(src, dst) {
    const a = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
      const sx = src[i].x;
      const sy = src[i].y;
      const dx = dst[i].x;
      const dy = dst[i].y;

      a.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
      b.push(dx);

      a.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
      b.push(dy);
    }

    const h = this.gaussianElimination(a, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  gaussianElimination(A, B) {
    const n = B.length;
    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }

      for (let k = i; k < n; k++) {
        const tmp = A[maxRow][k];
        A[maxRow][k] = A[i][k];
        A[i][k] = tmp;
      }
      const tmpB = B[maxRow];
      B[maxRow] = B[i];
      B[i] = tmpB;

      for (let k = i + 1; k < n; k++) {
        const c = -A[k][i] / (A[i][i] || 1e-10);
        for (let j = i; j < n; j++) {
          if (i === j) {
            A[k][j] = 0;
          } else {
            A[k][j] += c * A[i][j];
          }
        }
        B[k] += c * B[i];
      }
    }

    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) {
        sum += A[i][j] * x[j];
      }
      x[i] = (B[i] - sum) / (A[i][i] || 1e-10);
    }
    return x;
  }

  // --------------------------------------------------------------------------
  // ROCKETBOOK-GRADE VISION FILTERS
  // --------------------------------------------------------------------------

  /**
   * Fast 2D Separable Box Blur for single-channel float array.
   * O(w * h) linear runtime independent of kernel radius.
   */
  boxBlurChannel(src, w, h, radius) {
    const r = Math.max(1, Math.round(radius));
    const temp = new Float32Array(w * h);
    const dst = new Float32Array(w * h);

    // Pass 1: Horizontal sliding window
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      let count = 0;

      // Initial window [-r .. r]
      for (let x = -r; x <= r; x++) {
        if (x >= 0 && x < w) {
          sum += src[row + x];
          count++;
        }
      }

      for (let x = 0; x < w; x++) {
        temp[row + x] = sum / count;
        const addX = x + r + 1;
        const remX = x - r;
        if (addX < w) {
          sum += src[row + addX];
          count++;
        }
        if (remX >= 0) {
          sum -= src[row + remX];
          count--;
        }
      }
    }

    // Pass 2: Vertical sliding window
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;

      // Initial window [-r .. r]
      for (let y = -r; y <= r; y++) {
        if (y >= 0 && y < h) {
          sum += temp[y * w + x];
          count++;
        }
      }

      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / count;
        const addY = y + r + 1;
        const remY = y - r;
        if (addY < h) {
          sum += temp[addY * w + x];
          count++;
        }
        if (remY >= 0) {
          sum -= temp[remY * w + x];
          count--;
        }
      }
    }

    return dst;
  }

  /**
   * Estimate per-channel background illumination map (R, G, B) with ink suppression.
   * Clamping ink pixels upward ensures handwritten text does not artificially pull down
   * the local background estimate (eliminating halos around text).
   */
  estimateBackgroundRGB(rgba, w, h, radius) {
    const totalPixels = w * h;
    const rBuf = new Float32Array(totalPixels);
    const gBuf = new Float32Array(totalPixels);
    const bBuf = new Float32Array(totalPixels);

    // Ink-suppression step: clamp very dark stroke pixels up to estimated paper baseline
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // If ink (darker than typical paper), push up to ink-clamp floor
      if (lum < 155) {
        const floor = 175;
        rBuf[p] = Math.max(r, floor);
        gBuf[p] = Math.max(g, floor);
        bBuf[p] = Math.max(b, floor);
      } else {
        rBuf[p] = r;
        gBuf[p] = g;
        bBuf[p] = b;
      }
    }

    return {
      rBg: this.boxBlurChannel(rBuf, w, h, radius),
      gBg: this.boxBlurChannel(gBuf, w, h, radius),
      bBg: this.boxBlurChannel(bBuf, w, h, radius)
    };
  }

  /**
   * Fast luminance background estimator
   */
  estimateBackgroundLuminance(rgba, w, h, radius) {
    const totalPixels = w * h;
    const lumBuf = new Float32Array(totalPixels);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      // Ink-suppressed luminance
      lumBuf[p] = lum < 150 ? 175 : lum;
    }

    return this.boxBlurChannel(lumBuf, w, h, radius);
  }

  /**
   * Flat-field illumination normalization using large-kernel background estimation.
   * Completely eliminates desk shadows, light gradients, and paper yellowing.
   */
  flatFieldNormalize(rgba, w, h, radius, options = {}) {
    const { rBg, gBg, bBg } = this.estimateBackgroundRGB(rgba, w, h, radius);
    const whiteFloor = options.whiteFloor || 205;

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];

      // Local background divisor (clamped to prevent division by zero / deep shadows)
      const bgR = Math.max(45, rBg[p]);
      const bgG = Math.max(45, gBg[p]);
      const bgB = Math.max(45, bBg[p]);

      // Von Kries chromatic adaptation & flat-field division
      let nR = (r / bgR) * 255;
      let nG = (g / bgG) * 255;
      let nB = (b / bgB) * 255;

      const lum = 0.299 * nR + 0.587 * nG + 0.114 * nB;
      const chroma = Math.max(nR, nG, nB) - Math.min(nR, nG, nB);

      // Lock paper to pure white while preserving ink chromaticity
      if (lum >= whiteFloor && chroma < 35) {
        const t = Math.min(1.0, (lum - whiteFloor) / (255 - whiteFloor) * 1.5);
        nR = nR + (255 - nR) * t;
        nG = nG + (255 - nG) * t;
        nB = nB + (255 - nB) * t;
      }

      rgba[i]     = Math.min(255, Math.max(0, Math.round(nR)));
      rgba[i + 1] = Math.min(255, Math.max(0, Math.round(nG)));
      rgba[i + 2] = Math.min(255, Math.max(0, Math.round(nB)));
    }
  }

  /**
   * Intelligent color saturation boost for blue, black, red, and green pen inks
   * while locking the background paper to pure #FFFFFF white.
   */
  enhanceInkColors(rgba, w, h, options = {}) {
    for (let i = 0; i < rgba.length; i += 4) {
      let r = rgba[i];
      let g = rgba[i + 1];
      let b = rgba[i + 2];

      const maxVal = Math.max(r, g, b);
      const minVal = Math.min(r, g, b);
      const chroma = maxVal - minVal;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // 1. PAPER LOCK: Snap near-white paper background to pure #FFFFFF
      if (lum >= 210 && chroma < 32) {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        continue;
      }

      // 2. BLACK / DARK PENCIL INK: Deepen contrast and neutralize color cast
      if (chroma < 24) {
        // High contrast S-curve for rich jet black text
        const curve = Math.pow(Math.min(1.0, lum / 195), 1.45);
        let darkVal = Math.round(lum * curve);
        // Neutralize faint yellow/purple cast in black ballpoint
        rgba[i]     = Math.min(255, Math.max(0, darkVal));
        rgba[i + 1] = Math.min(255, Math.max(0, darkVal));
        rgba[i + 2] = Math.min(255, Math.max(0, darkVal));
        continue;
      }

      // 3. COLORED INKS: Blue, Red, Green, etc.
      // Calculate Hue angle (0 - 360)
      let hue = 0;
      if (maxVal === r) {
        hue = ((g - b) / (chroma || 1)) % 6;
      } else if (maxVal === g) {
        hue = (b - r) / (chroma || 1) + 2;
      } else {
        hue = (r - g) / (chroma || 1) + 4;
      }
      hue = Math.round(hue * 60);
      if (hue < 0) hue += 360;

      // Pilot FriXion / Ballpoint Ink Enhancements:
      if (hue >= 175 && hue <= 265) {
        // BLUE INK: Boost blue vibrancy and deepen value
        b = Math.min(255, Math.round(b * 1.15 + 15));
        r = Math.round(r * 0.75);
        g = Math.round(g * 0.85);
      } else if (hue >= 335 || hue <= 25) {
        // RED INK: Boost red pop and deepen value
        r = Math.min(255, Math.round(r * 1.15 + 15));
        g = Math.round(g * 0.72);
        b = Math.round(b * 0.72);
      } else if (hue >= 70 && hue <= 170) {
        // GREEN INK: Boost green pop and deepen value
        g = Math.min(255, Math.round(g * 1.15 + 12));
        r = Math.round(r * 0.75);
        b = Math.round(b * 0.78);
      } else {
        // OTHER INKS (Purple, Violet, Orange, Yellow): Boost saturation
        const mid = (maxVal + minVal) / 2;
        r = Math.round(mid + (r - mid) * 1.35);
        g = Math.round(mid + (g - mid) * 1.35);
        b = Math.round(mid + (b - mid) * 1.35);
      }

      rgba[i]     = Math.min(255, Math.max(0, r));
      rgba[i + 1] = Math.min(255, Math.max(0, g));
      rgba[i + 2] = Math.min(255, Math.max(0, b));
    }
  }

  /**
   * Unsharp mask filtering / Laplacian edge enhancement.
   * Produces razor-sharp handwritten ink edges without adding noise to white paper.
   */
  unsharpMask(rgba, w, h, amount = 0.85, threshold = 228) {
    const totalPixels = w * h;
    const origR = new Uint8Array(totalPixels);
    const origG = new Uint8Array(totalPixels);
    const origB = new Uint8Array(totalPixels);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      origR[p] = rgba[i];
      origG[p] = rgba[i + 1];
      origB[p] = rgba[i + 2];
    }

    // 3x3 Laplacian / Unsharp Kernel applied selectively to ink strokes
    for (let y = 1; y < h - 1; y++) {
      const rowOffset = y * w;
      for (let x = 1; x < w - 1; x++) {
        const p = rowOffset + x;
        const r = origR[p];
        const g = origG[p];
        const b = origB[p];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Skip pure white paper to prevent noise amplification
        if (lum > threshold) continue;

        // 4-neighbor average
        const rSurround = (origR[p - 1] + origR[p + 1] + origR[p - w] + origR[p + w]) * 0.25;
        const gSurround = (origG[p - 1] + origG[p + 1] + origG[p - w] + origG[p + w]) * 0.25;
        const bSurround = (origB[p - 1] + origB[p + 1] + origB[p - w] + origB[p + w]) * 0.25;

        // Edge detail difference
        const rDiff = r - rSurround;
        const gDiff = g - gSurround;
        const bDiff = b - bSurround;

        const outIdx = p * 4;
        rgba[outIdx]     = Math.min(255, Math.max(0, Math.round(r + amount * rDiff)));
        rgba[outIdx + 1] = Math.min(255, Math.max(0, Math.round(g + amount * gDiff)));
        rgba[outIdx + 2] = Math.min(255, Math.max(0, Math.round(b + amount * bDiff)));
      }
    }
  }

  /**
   * Enhanced B&W Adaptive Thresholding (Bradley-Roth Algorithm).
   * Generates clean 1-bit high-contrast black & white scans for photocopy & OCR.
   */
  adaptiveThreshold(rgba, w, h, windowSize, sensitivity = 0.13) {
    const bgMap = this.estimateBackgroundLuminance(rgba, w, h, windowSize);
    const factor = 1.0 - sensitivity;

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      const thresh = bgMap[p] * factor;
      const val = lum < thresh ? 0 : 255;
      rgba[i]     = val;
      rgba[i + 1] = val;
      rgba[i + 2] = val;
    }
  }

  /**
   * Enhanced Grayscale mode with background normalization and white paper lock.
   */
  normalizeGrayscale(rgba, w, h, radius) {
    const bgMap = this.estimateBackgroundLuminance(rgba, w, h, radius);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      const factor = 255 / Math.max(45, bgMap[p]);
      let normLum = lum * factor;

      // Lock paper to pure white, apply smooth curve to graphite/ink midtones
      if (normLum > 215) {
        normLum = 255;
      } else {
        normLum = Math.pow(normLum / 215, 1.35) * 215;
      }

      const val = Math.min(255, Math.max(0, Math.round(normLum)));
      rgba[i]     = val;
      rgba[i + 1] = val;
      rgba[i + 2] = val;
    }
  }

  /**
   * Apply Document Filters:
   * - 'magic': Authentic Rocketbook Magic Ink (Flat-field normalization, color boost, white lock, unsharp mask)
   * - 'bw': Clean high-contrast B&W adaptive thresholding
   * - 'grayscale': Background-normalized smooth grayscale
   * - 'color': Flat-field illumination normalized full color
   * - 'original': Raw perspective warp
   */
  applyFilter(canvas, filterType = 'magic', options = {}) {
    if (filterType === 'original') {
      return canvas;
    }

    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    const largeKernelRadius = Math.max(28, Math.round(Math.min(w, h) / 20));

    if (filterType === 'magic') {
      // 1. Flat-field normalization eliminates shadows and paper yellowing
      this.flatFieldNormalize(d, w, h, largeKernelRadius);

      // 2. Intelligent color boost for blue, black, red, green inks & lock paper to #FFFFFF
      this.enhanceInkColors(d, w, h);

      // 3. Unsharp mask / Laplacian edge enhancement for razor-sharp handwriting
      this.unsharpMask(d, w, h, 0.9, 228);

    } else if (filterType === 'bw') {
      // High-contrast adaptive thresholding
      const windowSize = Math.max(16, Math.round(w / 35));
      this.adaptiveThreshold(d, w, h, windowSize, 0.13);

    } else if (filterType === 'grayscale') {
      // Smooth grayscale with shadow removal & pure white background
      this.normalizeGrayscale(d, w, h, largeKernelRadius);

    } else if (filterType === 'color') {
      // Balanced flat-field color scan
      this.flatFieldNormalize(d, w, h, largeKernelRadius);
      this.unsharpMask(d, w, h, 0.6, 230);
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }
}

// Attach to window object for web & Electron environments
if (typeof window !== 'undefined') {
  window.VisionEngine = VisionEngine;
}

// Export for Node.js test environments if applicable
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VisionEngine;
}
