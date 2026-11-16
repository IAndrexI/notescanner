/**
 * VisionEngine: Fast Computer Vision for Document Scanning,
 * Corner Snapping, Perspective Transformation, and Rocketbook Filters.
 */
class VisionEngine {
  constructor() {
    this.cachedCanvas = document.createElement('canvas');
    this.cachedCtx = this.cachedCanvas.getContext('2d', { willReadFrequently: true });
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

    // Sort by angle relative to center
    const sorted = [...points].sort((a, b) => {
      const angleA = Math.atan2(a.y - cy, a.x - cx);
      const angleB = Math.atan2(b.y - cy, b.x - cx);
      return angleA - angleB;
    });

    // Top-left is in upper-left quadrant (angles around -3*pi/4)
    // Find the point with minimum (x + y)
    let tlIndex = 0;
    let minSum = Infinity;
    points.forEach((p, idx) => {
      const sum = p.x + p.y;
      if (sum < minSum) {
        minSum = sum;
        tlIndex = idx;
      }
    });

    // Rotate array so Top-Left is at index 0
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

    // 2. Simple Sobel gradient / edge energy map
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

      // Scan along the diagonal ray
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

  // Default inset corners (10% padding from borders)
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
    // We want mapping from dst -> src
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

    // Solve 8x8 linear system via Gaussian elimination
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

  // Apply Document Filters (Magic Ink, B&W, Grayscale, Original)
  applyFilter(canvas, filterType = 'magic') {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    if (filterType === 'original') {
      return canvas;
    }

    if (filterType === 'magic') {
      // Rocketbook "Magic Color" Enhancement:
      // Removes desk shadows, whitens paper background, amplifies dark ink, retains pen colors
      const blurRadius = Math.max(15, Math.round(w / 40));
      const bgMap = this.estimateBackgroundLuminance(d, w, h, blurRadius);

      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        const bg = bgMap[p]; // Local background brightness (0..255)
        const factor = 255 / Math.max(40, bg);

        // Normalize each channel by local background illumination
        let normR = r * factor;
        let normG = g * factor;
        let normB = b * factor;

        // Dynamic S-curve contrast expansion: push light grays to pure white, deepen ink
        const lum = 0.299 * normR + 0.587 * normG + 0.114 * normB;
        if (lum > 200) {
          // Flatten paper background to white
          const t = (lum - 200) / 55;
          normR = normR + (255 - normR) * t;
          normG = normG + (255 - normG) * t;
          normB = normB + (255 - normB) * t;
        } else {
          // Darken ink strokes
          const boost = Math.pow(lum / 200, 1.4);
          normR = normR * boost;
          normG = normG * boost;
          normB = normB * boost;
        }

        d[i]     = Math.min(255, Math.max(0, normR));
        d[i + 1] = Math.min(255, Math.max(0, normG));
        d[i + 2] = Math.min(255, Math.max(0, normB));
      }
    } else if (filterType === 'bw') {
      // Clean high-contrast B&W (Adaptive Thresholding)
      const windowSize = Math.max(16, Math.round(w / 35));
      const bgMap = this.estimateBackgroundLuminance(d, w, h, windowSize);

      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const thresh = bgMap[p] * 0.88; // 12% below local mean is ink
        const val = lum < thresh ? 0 : 255;
        d[i] = val;
        d[i + 1] = val;
        d[i + 2] = val;
      }
    } else if (filterType === 'grayscale') {
      // Grayscale with background normalization
      const bgMap = this.estimateBackgroundLuminance(d, w, h, 20);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const factor = 255 / Math.max(40, bgMap[p]);
        let val = lum * factor;
        val = val > 215 ? 255 : Math.pow(val / 215, 1.3) * 215;
        d[i] = val;
        d[i + 1] = val;
        d[i + 2] = val;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // Fast box-blur background luminance estimator
  estimateBackgroundLuminance(rgba, w, h, radius) {
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      lum[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }

    // Horizontal pass
    const temp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      let count = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) {
        if (x >= 0 && x < w) {
          sum += lum[row + x];
          count++;
        }
      }
      for (let x = 0; x < w; x++) {
        temp[row + x] = sum / (count || 1);
        const nextX = x + radius + 1;
        if (nextX < w) {
          sum += lum[row + nextX];
          count++;
        }
        const prevX = x - radius;
        if (prevX >= 0) {
          sum -= lum[row + prevX];
          count--;
        }
      }
    }

    // Vertical pass
    const result = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let y = -radius; y <= radius; y++) {
        if (y >= 0 && y < h) {
          sum += temp[y * w + x];
          count++;
        }
      }
      for (let y = 0; y < h; y++) {
        result[y * w + x] = sum / (count || 1);
        const nextY = y + radius + 1;
        if (nextY < h) {
          sum += temp[nextY * w + x];
          count++;
        }
        const prevY = y - radius;
        if (prevY >= 0) {
          sum -= temp[prevY * w + x];
          count--;
        }
      }
    }

    return result;
  }
}

window.VisionEngine = VisionEngine;
