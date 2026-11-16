/**
 * ExportManager: Multi-format document export engine for RocketScan.
 * Supports:
 * - PDF: Standard A4 & US Letter formats with high-efficiency JPEG compression
 * - High-Res JPEG: Fast, compact distribution
 * - Lossless PNG: Pixel-perfect digital archive
 * - Modern WebP: Ultra-efficient modern web format
 * - ZIP Bundle: Full archive containing all individual page images, compiled PDF, and Markdown summary
 * - Plain Text & Markdown: Complete header metadata & page manifests
 */
class ExportManager {
  /**
   * Available Export Formats with user-friendly metadata
   */
  static get FORMATS() {
    return [
      {
        id: 'pdf',
        name: 'Searchable PDF Document',
        ext: 'pdf',
        mime: 'application/pdf',
        icon: '📄',
        badge: 'A4 / Letter',
        description: 'Multi-page document with compressed high-res pages'
      },
      {
        id: 'jpeg',
        name: 'High-Res JPEG Image',
        ext: 'jpg',
        mime: 'image/jpeg',
        icon: '🖼️',
        badge: 'Compact',
        description: 'Standard high-resolution photos for quick sharing'
      },
      {
        id: 'png',
        name: 'Lossless PNG Image',
        ext: 'png',
        mime: 'image/png',
        icon: '✨',
        badge: 'Lossless',
        description: 'Pixel-perfect quality for handwriting and line drawings'
      },
      {
        id: 'webp',
        name: 'Modern WebP Image',
        ext: 'webp',
        mime: 'image/webp',
        icon: '🌐',
        badge: 'WebP',
        description: 'Next-generation web format with superior compression'
      },
      {
        id: 'zip',
        name: 'Complete ZIP Archive',
        ext: 'zip',
        mime: 'application/zip',
        icon: '📦',
        badge: 'Bundle',
        description: 'All individual pages + compiled PDF + Markdown summary'
      },
      {
        id: 'markdown',
        name: 'Markdown Summary',
        ext: 'md',
        mime: 'text/markdown',
        icon: '📝',
        badge: 'Docs',
        description: 'Document header, scan timestamp, and page manifest'
      },
      {
        id: 'txt',
        name: 'Plain Text Manifest',
        ext: 'txt',
        mime: 'text/plain',
        icon: '📋',
        badge: 'Text',
        description: 'Raw plain text document summary'
      }
    ];
  }

  /**
   * Helper: Convert Canvas to Blob
   */
  static canvasToBlob(canvas, mimeType = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error(`Failed to convert canvas to ${mimeType}`));
          }
        }, mimeType, quality);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Normalize input pages array: accepts array of { canvas } objects or raw canvases
   */
  static normalizePages(pages) {
    if (!pages) return [];
    const list = Array.isArray(pages) ? pages : [pages];
    return list.map((item, index) => {
      if (item && item.canvas) {
        return {
          id: item.id || index + 1,
          canvas: item.canvas,
          filter: item.filter || 'magic',
          rotation: item.rotation || 0
        };
      }
      return {
        id: index + 1,
        canvas: item,
        filter: 'magic',
        rotation: 0
      };
    }).filter(p => p.canvas && p.canvas.width > 0 && p.canvas.height > 0);
  }

  /**
   * Clean filename helper
   */
  static sanitizeFilename(name, defaultName = 'Scanned_Document') {
    if (!name || typeof name !== 'string') return defaultName;
    const sanitized = name.trim().replace(/[/\\?%*:|"<>]/g, '_');
    return sanitized.length > 0 ? sanitized : defaultName;
  }

  // --------------------------------------------------------------------------
  // 1. PDF EXPORT (A4 & Letter with compression)
  // --------------------------------------------------------------------------
  static async createPdf(pages, options = {}) {
    const normPages = ExportManager.normalizePages(pages);
    if (normPages.length === 0) {
      throw new Error('No pages provided for PDF creation');
    }

    // Get jsPDF instance
    let jsPDFClass = null;
    if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) {
      jsPDFClass = window.jspdf.jsPDF;
    } else if (typeof require !== 'undefined') {
      try {
        const jspdfModule = require('jspdf');
        jsPDFClass = jspdfModule.jsPDF;
      } catch (e) {}
    }

    if (!jsPDFClass) {
      throw new Error('jsPDF library is not loaded');
    }

    // Page format: 'a4' (210 x 297 mm) or 'letter' (215.9 x 279.4 mm)
    const pageSizeFormat = (options.pageSize || 'a4').toLowerCase() === 'letter' ? 'letter' : 'a4';
    const isLetter = pageSizeFormat === 'letter';
    const standardWidthMm = isLetter ? 215.9 : 210;
    const standardHeightMm = isLetter ? 279.4 : 297;

    const orientationMode = options.orientation || 'auto'; // 'portrait', 'landscape', or 'auto'
    const imageQuality = typeof options.quality === 'number' ? options.quality : 0.90;
    const marginMm = typeof options.margin === 'number' ? options.margin : 0;

    const doc = new jsPDFClass({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSizeFormat,
      compress: true
    });

    for (let i = 0; i < normPages.length; i++) {
      const page = normPages[i];
      const canvas = page.canvas;

      // Determine page orientation
      let isLandscape = false;
      if (orientationMode === 'landscape') {
        isLandscape = true;
      } else if (orientationMode === 'auto') {
        isLandscape = canvas.width > canvas.height;
      }

      const pWidth = isLandscape ? standardHeightMm : standardWidthMm;
      const pHeight = isLandscape ? standardWidthMm : standardHeightMm;
      const orientStr = isLandscape ? 'landscape' : 'portrait';

      if (i > 0) {
        doc.addPage(pageSizeFormat, orientStr);
      } else if (isLandscape) {
        // Adjust first page orientation if landscape
        doc.setPage(1);
        doc.deletePage(1);
        doc.addPage(pageSizeFormat, orientStr);
      }

      // Encode canvas to JPEG with specified quality
      const imgData = canvas.toDataURL('image/jpeg', imageQuality);

      const usableWidth = pWidth - (marginMm * 2);
      const usableHeight = pHeight - (marginMm * 2);

      const imgAspect = canvas.width / canvas.height;
      const pageAspect = usableWidth / usableHeight;

      let renderW = usableWidth;
      let renderH = usableHeight;
      let posX = marginMm;
      let posY = marginMm;

      if (imgAspect > pageAspect) {
        // Wider than printable area
        renderW = usableWidth;
        renderH = usableWidth / imgAspect;
        posY = marginMm + (usableHeight - renderH) / 2;
      } else {
        // Taller than printable area
        renderH = usableHeight;
        renderW = usableHeight * imgAspect;
        posX = marginMm + (usableWidth - renderW) / 2;
      }

      doc.addImage(imgData, 'JPEG', posX, posY, renderW, renderH, undefined, 'FAST');
    }

    const title = ExportManager.sanitizeFilename(options.title || 'Scanned_Document');
    const pdfBlob = doc.output('blob');

    return {
      blob: pdfBlob,
      filename: `${title}.pdf`,
      mimeType: 'application/pdf',
      size: pdfBlob.size,
      pageCount: normPages.length,
      format: pageSizeFormat.toUpperCase()
    };
  }

  // --------------------------------------------------------------------------
  // 2. IMAGE EXPORT (JPEG, PNG, WebP)
  // --------------------------------------------------------------------------
  static async createImage(pageOrCanvas, format = 'jpeg', options = {}) {
    const canvas = pageOrCanvas && pageOrCanvas.canvas ? pageOrCanvas.canvas : pageOrCanvas;
    if (!canvas || !canvas.toBlob) {
      throw new Error('Invalid canvas provided for image export');
    }

    const fmt = format.toLowerCase().replace('jpg', 'jpeg');
    let mimeType = 'image/jpeg';
    let ext = 'jpg';
    let quality = typeof options.quality === 'number' ? options.quality : 0.92;

    if (fmt === 'png') {
      mimeType = 'image/png';
      ext = 'png';
      quality = undefined; // PNG is lossless
    } else if (fmt === 'webp') {
      mimeType = 'image/webp';
      ext = 'webp';
      quality = typeof options.quality === 'number' ? options.quality : 0.90;
    }

    const title = ExportManager.sanitizeFilename(options.title || 'Page');
    const pageNum = options.pageNumber ? `_page_${String(options.pageNumber).padStart(2, '0')}` : '';
    const filename = `${title}${pageNum}.${ext}`;

    const blob = await ExportManager.canvasToBlob(canvas, mimeType, quality);

    return {
      blob,
      filename,
      mimeType,
      size: blob.size,
      width: canvas.width,
      height: canvas.height
    };
  }

  // --------------------------------------------------------------------------
  // 3. MARKDOWN & TEXT SUMMARY GENERATION
  // --------------------------------------------------------------------------
  static generateSummaryMarkdown(pages, options = {}) {
    const normPages = ExportManager.normalizePages(pages);
    const title = options.title || 'Scanned Document';
    const dateStr = options.date || new Date().toLocaleString();
    const library = options.library || 'Seafile Cloud';
    const folder = options.folder || '/RocketScan';

    let md = `# 📓 ${title}\n\n`;
    md += `*Scanned with RocketScan for Seafile*\n\n`;
    md += `## 📋 Document Overview\n`;
    md += `- **Title**: \`${title}\`\n`;
    md += `- **Date Scanned**: ${dateStr}\n`;
    md += `- **Total Pages**: ${normPages.length}\n`;
    md += `- **Target Seafile Library**: ${library}\n`;
    md += `- **Folder Path**: \`${folder}\`\n`;
    md += `- **Scan Processing**: Rocketbook Flat-Field Illumination & Ink Enhancement\n\n`;

    md += `## 📑 Page Manifest\n\n`;
    md += `| Page | Resolution | Aspect Ratio | Orientation | Filter Mode |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;

    normPages.forEach((p, idx) => {
      const w = p.canvas.width;
      const h = p.canvas.height;
      const orient = w >= h ? 'Landscape' : 'Portrait';
      const ratio = (w / h).toFixed(2);
      const filterName = p.filter === 'magic' ? '🪄 Magic Ink' :
                         p.filter === 'bw' ? '📄 Clean B&W' :
                         p.filter === 'grayscale' ? '🔘 Grayscale' :
                         p.filter === 'color' ? '🎨 Full Color' : '📷 Original';

      md += `| Page ${idx + 1} | ${w} × ${h} px | ${ratio} (${orient}) | ${orient} | ${filterName} |\n`;
    });

    md += `\n---\n`;
    md += `*Generated automatically by NoteScan • Seamless Rocketbook to Seafile Bridge*\n`;

    return md;
  }

  static generateSummaryText(pages, options = {}) {
    const normPages = ExportManager.normalizePages(pages);
    const title = options.title || 'Scanned Document';
    const dateStr = options.date || new Date().toLocaleString();
    const library = options.library || 'Seafile Cloud';
    const folder = options.folder || '/RocketScan';

    let txt = `=========================================================\n`;
    txt += `ROCKETSCAN DOCUMENT MANIFEST\n`;
    txt += `=========================================================\n\n`;
    txt += `Title:        ${title}\n`;
    txt += `Date:         ${dateStr}\n`;
    txt += `Total Pages:  ${normPages.length}\n`;
    txt += `Seafile Repo: ${library}\n`;
    txt += `Folder Path:  ${folder}\n`;
    txt += `Processing:   Rocketbook Illumination Normalization & Ink Sharpening\n\n`;
    txt += `PAGES MANIFEST:\n`;
    txt += `---------------------------------------------------------\n`;

    normPages.forEach((p, idx) => {
      const w = p.canvas.width;
      const h = p.canvas.height;
      const orient = w >= h ? 'Landscape' : 'Portrait';
      txt += `Page ${String(idx + 1).padStart(2, '0')}: ${w} x ${h} px [${orient}] (Filter: ${p.filter || 'magic'})\n`;
    });

    txt += `\n=========================================================\n`;
    txt += `Generated by NoteScan for Seafile\n`;
    txt += `=========================================================\n`;

    return txt;
  }

  // --------------------------------------------------------------------------
  // 4. ZIP BUNDLE (Images + Compiled PDF + Markdown Summary)
  // --------------------------------------------------------------------------
  static async createZipBundle(pages, options = {}) {
    const normPages = ExportManager.normalizePages(pages);
    if (normPages.length === 0) {
      throw new Error('No pages provided for ZIP archive');
    }

    // Check JSZip
    let JSZipClass = null;
    if (typeof window !== 'undefined' && window.JSZip) {
      JSZipClass = window.JSZip;
    } else if (typeof require !== 'undefined') {
      try {
        JSZipClass = require('jszip');
      } catch (e) {}
    }

    if (!JSZipClass) {
      throw new Error('JSZip library is not available. Please ensure jszip.min.js is included.');
    }

    const zip = new JSZipClass();
    const title = ExportManager.sanitizeFilename(options.title || 'Scanned_Document');
    const folderName = `${title}_bundle`;
    const root = zip.folder(folderName);
    const pagesFolder = root.folder('pages');

    // 1. Add individual page images
    const imgFormat = (options.imageFormat || 'png').toLowerCase();
    for (let i = 0; i < normPages.length; i++) {
      const page = normPages[i];
      const pageNumStr = String(i + 1).padStart(2, '0');
      const imgRes = await ExportManager.createImage(page.canvas, imgFormat, {
        title: `${title}_page_${pageNumStr}`
      });
      pagesFolder.file(`${title}_page_${pageNumStr}.${imgFormat === 'jpeg' ? 'jpg' : imgFormat}`, imgRes.blob);
    }

    // 2. Add compiled PDF document
    if (options.includePdf !== false) {
      try {
        const pdfRes = await ExportManager.createPdf(normPages, {
          title,
          pageSize: options.pageSize || 'a4',
          orientation: options.orientation || 'auto',
          quality: options.pdfQuality || 0.90
        });
        root.file(`${title}.pdf`, pdfRes.blob);
      } catch (pdfErr) {
        console.warn('PDF compilation in ZIP warning:', pdfErr);
      }
    }

    // 3. Add Markdown and Plain Text Summaries
    const mdSummary = ExportManager.generateSummaryMarkdown(normPages, { title, ...options });
    const txtSummary = ExportManager.generateSummaryText(normPages, { title, ...options });
    root.file('README.md', mdSummary);
    root.file('manifest.txt', txtSummary);

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      blob: zipBlob,
      filename: `${title}_archive.zip`,
      mimeType: 'application/zip',
      size: zipBlob.size,
      pageCount: normPages.length
    };
  }

  // --------------------------------------------------------------------------
  // 5. UNIFIED EXPORT DISPATCHER & DOWNLOAD HELPERS
  // --------------------------------------------------------------------------
  /**
   * Export document in requested format:
   * 'pdf', 'jpeg', 'jpg', 'png', 'webp', 'zip', 'markdown', 'md', 'txt'
   */
  static async exportDocument(pages, format = 'pdf', options = {}) {
    const fmt = format.toLowerCase().trim();

    switch (fmt) {
      case 'pdf':
        return await ExportManager.createPdf(pages, options);

      case 'jpg':
      case 'jpeg': {
        const normPages = ExportManager.normalizePages(pages);
        if (normPages.length === 1 || options.singlePage) {
          const target = options.pageIndex !== undefined ? normPages[options.pageIndex] : normPages[0];
          return await ExportManager.createImage(target, 'jpeg', options);
        }
        // Multi-page JPEG requests default to ZIP bundle of JPEGs
        return await ExportManager.createZipBundle(normPages, { ...options, imageFormat: 'jpeg' });
      }

      case 'png': {
        const normPages = ExportManager.normalizePages(pages);
        if (normPages.length === 1 || options.singlePage) {
          const target = options.pageIndex !== undefined ? normPages[options.pageIndex] : normPages[0];
          return await ExportManager.createImage(target, 'png', options);
        }
        // Multi-page PNG requests default to ZIP bundle of PNGs
        return await ExportManager.createZipBundle(normPages, { ...options, imageFormat: 'png' });
      }

      case 'webp': {
        const normPages = ExportManager.normalizePages(pages);
        if (normPages.length === 1 || options.singlePage) {
          const target = options.pageIndex !== undefined ? normPages[options.pageIndex] : normPages[0];
          return await ExportManager.createImage(target, 'webp', options);
        }
        // Multi-page WebP requests default to ZIP bundle of WebPs
        return await ExportManager.createZipBundle(normPages, { ...options, imageFormat: 'webp' });
      }

      case 'zip':
        return await ExportManager.createZipBundle(pages, options);

      case 'md':
      case 'markdown': {
        const title = ExportManager.sanitizeFilename(options.title || 'Scanned_Document');
        const mdText = ExportManager.generateSummaryMarkdown(pages, options);
        const mdBlob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' });
        return {
          blob: mdBlob,
          filename: `${title}_summary.md`,
          mimeType: 'text/markdown',
          size: mdBlob.size,
          text: mdText
        };
      }

      case 'txt': {
        const title = ExportManager.sanitizeFilename(options.title || 'Scanned_Document');
        const txtText = ExportManager.generateSummaryText(pages, options);
        const txtBlob = new Blob([txtText], { type: 'text/plain;charset=utf-8' });
        return {
          blob: txtBlob,
          filename: `${title}_manifest.txt`,
          mimeType: 'text/plain',
          size: txtBlob.size,
          text: txtText
        };
      }

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Browser-safe file download trigger
   */
  static downloadBlob(blob, filename) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 150);
  }

  /**
   * One-tap Export and Download
   */
  static async downloadDocument(pages, format = 'pdf', options = {}) {
    const result = await ExportManager.exportDocument(pages, format, options);
    ExportManager.downloadBlob(result.blob, result.filename);
    return result;
  }
}

// Global window registration
if (typeof window !== 'undefined') {
  window.ExportManager = ExportManager;
}

// Node.js module export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExportManager;
}
