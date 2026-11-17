const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing RocketScan Apple / iOS Compatibility, Direct Sharing & UI Integration ---');

// 1. Check index.html
const indexHtml = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

assert(indexHtml.includes('playsinline'), 'index.html must include playsinline');
assert(indexHtml.includes('webkit-playsinline'), 'index.html must include webkit-playsinline');
assert(indexHtml.includes('viewport-fit=cover'), 'index.html should include viewport-fit=cover for iOS notch / safe areas');
assert(indexHtml.includes('id="file-camera-direct"'), 'index.html must include direct camera file input fallback');
assert(indexHtml.includes('capture="environment"'), 'direct camera input must have capture="environment"');
assert(indexHtml.includes('id="btn-camera-direct"'), 'index.html must have #btn-camera-direct');
assert(indexHtml.includes('id="camera-permission-fallback"'), 'index.html must have camera permission fallback card');
assert(indexHtml.includes('id="ios-a2hs-banner"'), 'index.html must have iOS Add to Home Screen banner');
assert(indexHtml.includes('id="btn-close-a2hs"'), 'index.html must have close button for A2HS banner');
assert(indexHtml.includes('id="mobile-nav"'), 'index.html must include mobile bottom navigation bar');
assert(indexHtml.includes('id="mobile-nav-scanner"'), 'mobile nav must include Scan button');
assert(indexHtml.includes('id="mobile-nav-gallery"'), 'mobile nav must include PC Notes button');
assert(indexHtml.includes('id="mobile-nav-settings"'), 'mobile nav must include Settings button');
assert(indexHtml.includes('id="btn-export-pdf"'), 'index.html must have 1-tap Save PDF button');
assert(indexHtml.includes('id="btn-export-jpeg"'), 'index.html must have 1-tap Save Image button');
assert(indexHtml.includes('id="btn-export-share"'), 'index.html must have 1-tap Share File button');
assert(!indexHtml.includes('id="btn-export-dropdown"'), 'nested export dropdown must be removed');
assert(!indexHtml.includes('id="export-dropdown-menu"'), 'nested export dropdown menu must be removed');
assert(!indexHtml.includes('id="save-format-select"'), 'multi-format select matrix must be removed');
assert(indexHtml.includes('id="btn-modal-save-pdf"'), 'save modal must have Save PDF button');
assert(indexHtml.includes('id="btn-modal-save-image"'), 'save modal must have Save Image button');
assert(indexHtml.includes('id="btn-modal-share-file"'), 'save modal must have Share File button');
assert(indexHtml.includes('id="setting-save-gallery"'), 'settings modal must have Save copy to phone gallery toggle');
assert(indexHtml.includes('id="modal-qr-share"'), 'index.html must have QR Code Direct File Share modal');
assert(indexHtml.includes('id="qr-share-canvas"'), 'QR modal must have canvas');
assert(indexHtml.includes('id="qr-share-url-input"'), 'QR modal must have URL input');
assert(indexHtml.includes('id="btn-copy-share-url"'), 'QR modal must have copy button');
assert(indexHtml.includes('/js/qrcode.min.js'), 'index.html must load qrcode.min.js');
assert(indexHtml.includes('/js/export-manager.js'), 'index.html must load export-manager.js');
assert(indexHtml.includes('/js/updater.js'), 'index.html must load updater.js');

console.log('✓ index.html structure, iOS elements, QR modal, and export controls verified!');

// 2. Check scanner.js
const scannerJs = fs.readFileSync(path.join(__dirname, 'public/js/scanner.js'), 'utf8');
assert(scannerJs.includes('playsinline'), 'scanner.js must assert playsinline attribute');
assert(scannerJs.includes('webkit-playsinline'), 'scanner.js must assert webkit-playsinline attribute');
assert(scannerJs.includes('isIOS'), 'scanner.js must implement isIOS() detection');
assert(scannerJs.includes('getRearCameraDeviceId'), 'scanner.js should support rear camera device selection');
assert(scannerJs.includes('facingMode'), 'scanner.js must specify facingMode environment fallback');

console.log('✓ scanner.js iOS video attributes and camera fallbacks verified!');

// 3. Check qrcode.min.js
const qrcodeJs = fs.readFileSync(path.join(__dirname, 'public/js/qrcode.min.js'), 'utf8');
assert(qrcodeJs.length > 10000, 'qrcode.min.js should be bundled');
assert(qrcodeJs.includes('toDataURL'), 'qrcode.min.js must contain toDataURL');

console.log('✓ qrcode.min.js client-side library verified!');

// 4. Check styles.css
const stylesCss = fs.readFileSync(path.join(__dirname, 'public/css/styles.css'), 'utf8');
assert(stylesCss.includes('touch-action: manipulation;'), 'styles.css must have touch-action: manipulation;');
assert(stylesCss.includes('overscroll-behavior: none;'), 'styles.css must prevent rubber-banding');
assert(stylesCss.includes('.ios-a2hs-banner'), 'styles.css must style .ios-a2hs-banner');
assert(stylesCss.includes('.camera-fallback-card'), 'styles.css must style .camera-fallback-card');
assert(stylesCss.includes('100dvh'), 'styles.css must support dynamic viewport height (100dvh)');
assert(stylesCss.includes('safe-area-inset-top'), 'styles.css must support safe-area-inset-top');
assert(stylesCss.includes('safe-area-inset-bottom'), 'styles.css must support safe-area-inset-bottom');
assert(stylesCss.includes('.mobile-bottom-nav'), 'styles.css must style .mobile-bottom-nav');
assert(stylesCss.includes('.export-actions-row'), 'styles.css must style .export-actions-row');
assert(stylesCss.includes('.qr-share-dialog'), 'styles.css must style QR share modal');

console.log('✓ styles.css iOS touch optimizations and UI styles verified!');

// 5. Check app.js
const appJs = fs.readFileSync(path.join(__dirname, 'public/js/app.js'), 'utf8');
assert(appJs.includes('handleWebShareCurrentDocument'), 'app.js must implement handleWebShareCurrentDocument');
assert(appJs.includes('openQrShareModal'), 'app.js must implement openQrShareModal');
assert(appJs.includes('initIosA2hs'), 'app.js must implement initIosA2hs');
assert(appJs.includes('handleQrShareNote'), 'app.js must implement handleQrShareNote');
assert(appJs.includes('handleWebShareNote'), 'app.js must implement handleWebShareNote');
assert(appJs.includes('btn-camera-direct'), 'app.js must wire up direct camera button');
assert(appJs.includes('file-camera-direct'), 'app.js must wire up direct camera file input');
assert(appJs.includes('btn-export-pdf'), 'app.js must wire up Save PDF button');
assert(appJs.includes('btn-export-jpeg'), 'app.js must wire up Save Image button');
assert(appJs.includes('btn-export-share'), 'app.js must wire up Share File button');
assert(appJs.includes('mobile-nav-settings'), 'app.js must wire up mobile bottom nav Settings button');
assert(appJs.includes('saveScanCopyLocally'), 'app.js must implement saveScanCopyLocally for local phone gallery/IndexedDB saving');
assert(appJs.includes('NoteScanNative'), 'app.js must integrate Android NoteScanNative.saveFileToDevice bridge');

console.log('✓ app.js direct sharing, QR modal, and iOS camera wiring verified!');

// 6. Check server.js /api/qrcode endpoint
const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
assert(serverJs.includes('/api/qrcode'), 'server.js must implement /api/qrcode endpoint');

console.log('✓ server.js QR Code generation endpoint verified!');

console.log('\n>>> ALL APPLE/iOS COMPATIBILITY, DIRECT SHARING & UI INTEGRATION TESTS PASSED! <<<');
