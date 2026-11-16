// Comprehensive test of ExportManager
const ExportManager = require('./public/js/export-manager.js');

async function testExportManager() {
  console.log("Testing ExportManager formats...");
  const formats = ExportManager.FORMATS;
  console.log(`Available formats (${formats.length}):`, formats.map(f => f.id).join(', '));
  if (formats.length < 5) throw new Error("Expected at least 5 export formats");

  // Valid 1x1 JPEG in Base64
  const VALID_JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

  function createMockCanvas(w, h) {
    return {
      width: w,
      height: h,
      toDataURL: (mime, q) => VALID_JPEG_DATA_URL,
      toBlob: (cb, mime, q) => {
        const mockBuffer = Buffer.from('mock_image_bytes');
        cb(new Blob([mockBuffer], { type: mime || 'image/jpeg' }));
      }
    };
  }

  const mockPages = [
    { id: 1, canvas: createMockCanvas(1200, 1600), filter: 'magic' },
    { id: 2, canvas: createMockCanvas(1600, 1200), filter: 'bw' }
  ];

  // 1. Markdown Summary
  console.log("Testing Markdown summary...");
  const md = ExportManager.generateSummaryMarkdown(mockPages, { title: 'Test Notes' });
  if (!md.includes('Test Notes') || !md.includes('Page 1') || !md.includes('Page 2')) {
    throw new Error("Markdown summary missing page content");
  }
  console.log("Markdown summary verified.");

  // 2. Text Summary
  console.log("Testing Text summary...");
  const txt = ExportManager.generateSummaryText(mockPages, { title: 'Test Notes' });
  if (!txt.includes('Page 01') || !txt.includes('Page 02')) {
    throw new Error("Text summary missing page content");
  }
  console.log("Text summary verified.");

  // 3. PDF generation (A4 and Letter)
  console.log("Testing PDF generation (A4)...");
  const a4Res = await ExportManager.createPdf(mockPages, { title: 'Test A4', pageSize: 'a4' });
  console.log(`A4 PDF generated: ${a4Res.filename}, size: ${a4Res.size} bytes, format: ${a4Res.format}`);
  if (a4Res.filename !== 'Test A4.pdf' || !a4Res.blob) {
    throw new Error("A4 PDF generation failed");
  }

  console.log("Testing PDF generation (Letter)...");
  const letterRes = await ExportManager.createPdf(mockPages, { title: 'Test Letter', pageSize: 'letter' });
  console.log(`Letter PDF generated: ${letterRes.filename}, size: ${letterRes.size} bytes, format: ${letterRes.format}`);
  if (letterRes.filename !== 'Test Letter.pdf' || letterRes.format !== 'LETTER') {
    throw new Error("Letter PDF generation failed");
  }

  // 4. Image creation (JPEG, PNG, WebP)
  console.log("Testing Image creation...");
  const jpgRes = await ExportManager.createImage(mockPages[0].canvas, 'jpeg', { title: 'Test' });
  if (jpgRes.mimeType !== 'image/jpeg') throw new Error("JPEG mimeType mismatch");

  const pngRes = await ExportManager.createImage(mockPages[0].canvas, 'png', { title: 'Test' });
  if (pngRes.mimeType !== 'image/png') throw new Error("PNG mimeType mismatch");

  const webpRes = await ExportManager.createImage(mockPages[0].canvas, 'webp', { title: 'Test' });
  if (webpRes.mimeType !== 'image/webp') throw new Error("WebP mimeType mismatch");
  console.log("Image generation verified for JPEG, PNG, and WebP.");

  // 5. ZIP Bundle creation
  console.log("Testing ZIP bundle creation...");
  const zipRes = await ExportManager.createZipBundle(mockPages, { title: 'Test_Bundle' });
  console.log(`ZIP generated: ${zipRes.filename}, size: ${zipRes.size} bytes`);
  if (!zipRes.blob || zipRes.filename !== 'Test_Bundle_archive.zip') {
    throw new Error("ZIP bundle creation failed");
  }

  // 6. Unified exportDocument dispatcher
  console.log("Testing exportDocument dispatcher for 'markdown'...");
  const docMd = await ExportManager.exportDocument(mockPages, 'markdown', { title: 'Dispatch' });
  if (!docMd.filename.endsWith('.md')) throw new Error("Dispatcher failed for markdown");

  console.log("Testing exportDocument dispatcher for 'zip'...");
  const docZip = await ExportManager.exportDocument(mockPages, 'zip', { title: 'Dispatch' });
  if (!docZip.filename.endsWith('.zip')) throw new Error("Dispatcher failed for zip");

  console.log("ALL EXPORT MANAGER TESTS PASSED SUCCESSFULLY! 🚀");
}

testExportManager().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
