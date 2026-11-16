// Test VisionEngine algorithms
const VisionEngine = require('./public/js/vision.js');

const engine = new VisionEngine();

const w = 200;
const h = 200;
const rgba = new Uint8ClampedArray(w * h * 4);

// Fill with yellowed paper with a shadow gradient
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const idx = (y * w + x) * 4;
    const shadowFactor = 0.7 + 0.3 * (1 - y / h); // darker at bottom
    rgba[idx] = Math.round(235 * shadowFactor);     // R
    rgba[idx + 1] = Math.round(225 * shadowFactor); // G
    rgba[idx + 2] = Math.round(180 * shadowFactor); // B (yellowish)
    rgba[idx + 3] = 255;
  }
}

// Add a blue ink stroke at y=50, x=50..150
for (let x = 50; x < 150; x++) {
  const idx = (50 * w + x) * 4;
  rgba[idx] = 40;
  rgba[idx + 1] = 65;
  rgba[idx + 2] = 160;
}

// Add a black ink stroke at y=100, x=50..150
for (let x = 50; x < 150; x++) {
  const idx = (100 * w + x) * 4;
  rgba[idx] = 50;
  rgba[idx + 1] = 50;
  rgba[idx + 2] = 50;
}

// Add a red ink stroke at y=150, x=50..150
for (let x = 50; x < 150; x++) {
  const idx = (150 * w + x) * 4;
  rgba[idx] = 180;
  rgba[idx + 1] = 40;
  rgba[idx + 2] = 45;
}

// Test 1: Flat-field normalization
engine.flatFieldNormalize(rgba, w, h, 20);

// Check paper at y=20, x=20 (was shadowed/yellowed)
const pIdx = (20 * w + 20) * 4;
console.log(`Paper after normalization: R=${rgba[pIdx]}, G=${rgba[pIdx+1]}, B=${rgba[pIdx+2]}`);
if (rgba[pIdx] < 245 || rgba[pIdx+1] < 245 || rgba[pIdx+2] < 245) {
  throw new Error(`Paper did not normalize to white: ${rgba[pIdx]}, ${rgba[pIdx+1]}, ${rgba[pIdx+2]}`);
}

// Test 2: Ink color enhancement
engine.enhanceInkColors(rgba, w, h);

// Check paper is locked to 255
console.log(`Paper after ink enhancement & white lock: R=${rgba[pIdx]}, G=${rgba[pIdx+1]}, B=${rgba[pIdx+2]}`);
if (rgba[pIdx] !== 255 || rgba[pIdx+1] !== 255 || rgba[pIdx+2] !== 255) {
  throw new Error(`Paper is not #FFFFFF: ${rgba[pIdx]}, ${rgba[pIdx+1]}, ${rgba[pIdx+2]}`);
}

// Check blue ink at y=50, x=100
const blueIdx = (50 * w + 100) * 4;
console.log(`Blue ink: R=${rgba[blueIdx]}, G=${rgba[blueIdx+1]}, B=${rgba[blueIdx+2]}`);
if (rgba[blueIdx+2] <= rgba[blueIdx] || rgba[blueIdx+2] <= rgba[blueIdx+1]) {
  throw new Error("Blue ink was not boosted!");
}

// Check black ink at y=100, x=100
const blackIdx = (100 * w + 100) * 4;
console.log(`Black ink: R=${rgba[blackIdx]}, G=${rgba[blackIdx+1]}, B=${rgba[blackIdx+2]}`);
if (rgba[blackIdx] > 60 || rgba[blackIdx+1] > 60 || rgba[blackIdx+2] > 60) {
  throw new Error("Black ink contrast was not deepened!");
}

// Check red ink at y=150, x=100
const redIdx = (150 * w + 100) * 4;
console.log(`Red ink: R=${rgba[redIdx]}, G=${rgba[redIdx+1]}, B=${rgba[redIdx+2]}`);
if (rgba[redIdx] <= rgba[redIdx+1] || rgba[redIdx] <= rgba[redIdx+2]) {
  throw new Error("Red ink was not boosted!");
}

// Test 3: Unsharp mask
engine.unsharpMask(rgba, w, h, 0.9, 228);
// Verify paper is still pristine 255, 255, 255
if (rgba[pIdx] !== 255 || rgba[pIdx+1] !== 255 || rgba[pIdx+2] !== 255) {
  throw new Error("Unsharp mask introduced noise to white paper!");
}

// Test 4: B&W Adaptive thresholding
const bwRgba = new Uint8ClampedArray(rgba);
engine.adaptiveThreshold(bwRgba, w, h, 15, 0.13);
// Check that all values are strictly 0 or 255
let hasZero = false;
let has255 = false;
for (let i = 0; i < bwRgba.length; i += 4) {
  const v = bwRgba[i];
  if (v !== 0 && v !== 255) throw new Error(`Non-binary value in B&W: ${v}`);
  if (v === 0) hasZero = true;
  if (v === 255) has255 = true;
}
if (!hasZero || !has255) throw new Error("B&W thresholding failed to separate ink and paper");
console.log("B&W adaptive thresholding verified: pure 1-bit binary output.");

// Test 5: Grayscale
const grayRgba = new Uint8ClampedArray(rgba);
engine.normalizeGrayscale(grayRgba, w, h, 20);
for (let i = 0; i < grayRgba.length; i += 4) {
  if (grayRgba[i] !== grayRgba[i+1] || grayRgba[i] !== grayRgba[i+2]) {
    throw new Error(`Grayscale channels not equal at index ${i}`);
  }
}
console.log("Grayscale normalization verified: R=G=B for all pixels.");

console.log("ALL VISION ENGINE TESTS PASSED SUCCESSFULLY! 🚀");
