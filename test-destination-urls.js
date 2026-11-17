const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('--- Testing Destination URLs Only (No Hardcoded Presets) ---');

// 1. Test StorageManager directly
const StorageManager = require('./public/js/storage.js');

const defaults = StorageManager.getDefaultSettings();
assert.strictEqual('presets' in defaults, false, 'getDefaultSettings must not include presets');
assert.deepStrictEqual(defaults.destinationUrls, [], 'default destinationUrls must be empty array');
assert.deepStrictEqual(defaults.directLinks, [], 'default directLinks must be empty array');
assert.strictEqual(defaults.saveCopyToGallery, true, 'default saveCopyToGallery must be true');

assert.deepStrictEqual(StorageManager.getDestinationUrls(), [], 'initial destinationUrls must be empty');

// Add destination URLs
const added1 = StorageManager.addDestinationUrl('Seafile Upload', 'https://seafile.protutech.vip/u/d/abc123/');
assert.strictEqual(added1.name, 'Seafile Upload');
assert.strictEqual(added1.url, 'https://seafile.protutech.vip/u/d/abc123/');

const added2 = StorageManager.addDestinationUrl('', 'hooks.example.com/ingest');
assert.strictEqual(added2.url, 'https://hooks.example.com/ingest');
assert.strictEqual(added2.name, 'hooks.example.com');

let list = StorageManager.getDestinationUrls();
assert.strictEqual(list.length, 2, 'should have 2 saved destination URLs');
assert.deepStrictEqual(StorageManager.getDirectLinks(), list, 'getDirectLinks alias must stay in sync');

// Update destination URL
StorageManager.updateDestinationUrl(added2.id, {
  name: 'Team Webhook',
  url: 'https://hooks.example.com/v2/notes'
});
list = StorageManager.getDestinationUrls();
assert.strictEqual(list[1].name, 'Team Webhook');
assert.strictEqual(list[1].url, 'https://hooks.example.com/v2/notes');

// Save settings should strip legacy presets and preserve destinationUrls
const savedCfg = StorageManager.saveSettings({
  presets: [{ id: 'notes', name: 'Notes' }],
  autoUpload: false
});
assert.strictEqual('presets' in savedCfg, false, 'saveSettings must strip presets');
assert.strictEqual(savedCfg.destinationUrls.length, 2);

// Remove destination URLs
StorageManager.removeDestinationUrl(added1.id);
assert.strictEqual(StorageManager.getDestinationUrls().length, 1);
StorageManager.removeDestinationUrl(added2.id);
assert.deepStrictEqual(StorageManager.getDestinationUrls(), [], 'destinationUrls should be empty after removals');

console.log('✓ StorageManager destination URL CRUD and preset removal verified!');

// 2. Verify public/index.html structure
const indexHtml = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
assert(!indexHtml.includes('id="presets-config-list"'), 'index.html must not contain #presets-config-list');
assert(!indexHtml.includes('id="btn-add-preset"'), 'index.html must not contain #btn-add-preset');
assert(!indexHtml.includes('/RocketScan'), 'index.html must not contain hardcoded /RocketScan');
assert(!indexHtml.includes('RocketBook Scans'), 'index.html must not contain hardcoded RocketBook Scans');
assert(indexHtml.includes('id="quick-dest-bar"'), 'index.html must include #quick-dest-bar');
assert(indexHtml.includes('id="quick-dest-pills"'), 'index.html must include #quick-dest-pills');
assert(indexHtml.includes('id="settings-destination-urls-section"'), 'index.html must include #settings-destination-urls-section');
assert(indexHtml.includes('id="new-dest-name"'), 'index.html must include #new-dest-name');
assert(indexHtml.includes('id="new-dest-url"'), 'index.html must include #new-dest-url');
assert(indexHtml.includes('id="btn-add-destination-url"'), 'index.html must include #btn-add-destination-url');
assert(indexHtml.includes('id="destination-urls-list"'), 'index.html must include #destination-urls-list');

// Check Destination URLs section appears before Seafile Account Login in Settings
const destIdx = indexHtml.indexOf('id="settings-destination-urls-section"');
const loginIdx = indexHtml.indexOf('Seafile Account Login');
assert(destIdx > 0 && loginIdx > destIdx, 'Destination URLs must be the primary/first section in Settings modal');

console.log('✓ public/index.html Destination URLs UI verified!');

// 3. Verify public/js/app.js has no hardcoded presets & test renderQuickDestinationPills behavior
const appJs = fs.readFileSync(path.join(__dirname, 'public/js/app.js'), 'utf8');
assert(!appJs.includes('DEFAULT_PRESETS'), 'app.js must not define DEFAULT_PRESETS');
assert(!appJs.includes('/RocketScan'), 'app.js must not contain hardcoded /RocketScan');
assert(!appJs.includes("'receipts'") && !appJs.includes("'journal'"), 'app.js must not contain hardcoded receipts/journal presets');
assert(appJs.includes('No destination URLs configured. Tap to add URL'), 'app.js must display exact empty prompt');

// Lightweight DOM + VM check of renderQuickDestinationPills and handleSendToDestinationUrl
function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(val) {
      this._innerHTML = String(val ?? '');
      if (this._innerHTML === '') this.children = [];
    },
    title: '',
    style: {},
    attributes: {},
    children: [],
    listeners: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    click() {
      const fns = this.listeners.click || [];
      fns.forEach(fn => fn({ preventDefault() {}, stopPropagation() {} }));
    },
    classList: { add() {}, remove() {}, toggle() {} },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  return el;
}

const quickDestPills = makeElement('div');
quickDestPills.id = 'quick-dest-pills';
const modalQuickDestPills = makeElement('div');
modalQuickDestPills.id = 'modal-quick-dest-pills';

let sentTargetUrl = null;
const sandbox = {
  console,
  Date,
  URL,
  Math,
  setTimeout: () => 0,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  StorageManager,
  VisionEngine: function () {},
  CameraScanner: function () {},
  PdfBuilder: { createPdfFromPages: async () => ({ size: 128, type: 'application/pdf' }) },
  ExportManager: {
    sanitizeFilename: (s) => s,
    createImage: async () => ({ blob: {}, filename: 'test.jpg', size: 100 }),
    downloadBlob() {}
  },
  SeafileApi: {
    sendToDirectLink: async (url) => {
      sentTargetUrl = url;
      return { success: true };
    }
  },
  document: {
    addEventListener() {},
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => {
      if (id === 'quick-dest-pills') return quickDestPills;
      if (id === 'modal-quick-dest-pills') return modalQuickDestPills;
      return null;
    },
    querySelectorAll: () => []
  },
  window: {}
};
sandbox.window = sandbox;

vm.runInNewContext(appJs, sandbox);

// Case A: Empty destinationUrls -> prompt text
vm.runInContext('state.destinationUrls = []; renderQuickDestinationPills();', sandbox);
assert.strictEqual(quickDestPills.children.length, 1, 'empty state should render 1 prompt element');
assert.strictEqual(
  quickDestPills.children[0].textContent,
  'No destination URLs configured. Tap to add URL',
  'empty prompt text must match exactly'
);

// Case B: User adds 2 Destination URLs -> ONLY those 2 pills appear, 1-tap sends to URL
vm.runInContext(`
  state.destinationUrls = [
    { id: 'd1', name: 'Seafile Drop', url: 'https://seafile.protutech.vip/u/d/drop1/' },
    { id: 'd2', name: 'Webhook', url: 'https://hooks.example.com/scan' }
  ];
  state.pages = [{ id: 1, canvas: { toDataURL: () => 'data:image/jpeg;base64,AA==' }, filter: 'magic' }];
  state.seafileConfig.saveCopyToGallery = false;
  renderQuickDestinationPills();
`, sandbox);

assert.strictEqual(quickDestPills.children.length, 2, 'must render ONLY the 2 user-added URL pills');
assert.strictEqual(quickDestPills.children[0].getAttribute('data-destination-url'), 'https://seafile.protutech.vip/u/d/drop1/');
assert.strictEqual(quickDestPills.children[1].getAttribute('data-destination-url'), 'https://hooks.example.com/scan');

// 1-tap on first pill
quickDestPills.children[0].click();
setImmediate(() => {
  assert.strictEqual(sentTargetUrl, 'https://seafile.protutech.vip/u/d/drop1/', '1-tap pill click must send directly to that URL');
  console.log('✓ app.js renderQuickDestinationPills & 1-tap URL send verified!');
  console.log('\n>>> ALL DESTINATION URL TESTS PASSED! <<<');
});
