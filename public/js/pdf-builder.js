/**
 * PdfBuilder: Assembles multiple scanned pages into a standard PDF or image files.
 */
class PdfBuilder {
  // Convert a canvas to a Blob
  static canvasToBlob(canvas, mimeType = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, mimeType, quality);
    });
  }

  // Generate a multi-page PDF document
  static async createPdfFromPages(pages, options = {}) {
    if (!pages || pages.length === 0) {
      throw new Error('No pages provided for PDF creation');
    }

    // Ensure jsPDF is loaded
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      throw new Error('jsPDF library is not loaded');
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = 210;
    const pageHeight = 297;

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        doc.addPage('a4', 'portrait');
      }

      const canvas = pages[i].canvas;
      const imgData = canvas.toDataURL('image/jpeg', 0.90);

      // Fit image into A4 page while preserving aspect ratio
      const imgAspect = canvas.width / canvas.height;
      const pageAspect = pageWidth / pageHeight;

      let renderW = pageWidth;
      let renderH = pageHeight;
      let posX = 0;
      let posY = 0;

      if (imgAspect > pageAspect) {
        // Image is wider than A4
        renderW = pageWidth;
        renderH = pageWidth / imgAspect;
        posY = (pageHeight - renderH) / 2;
      } else {
        // Image is taller than A4
        renderH = pageHeight;
        renderW = pageHeight * imgAspect;
        posX = (pageWidth - renderW) / 2;
      }

      doc.addImage(imgData, 'JPEG', posX, posY, renderW, renderH, undefined, 'FAST');
    }

    const pdfBlob = doc.output('blob');
    return pdfBlob;
  }
}

window.PdfBuilder = PdfBuilder;
