/**
 * HandwritingConverter: Converts handwritten notes into selectable/clean digital fonts
 * while preserving diagrams, drawings, sketches, and doodles.
 * Supports converting the entire document or user-selected specific regions.
 */

class HandwritingConverter {
  constructor() {
    this.originalCanvas = null;
    this.workingCanvas = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.stageContainer = null;
    this.lines = []; // Array of detected line objects
    this.selectedBox = null; // { x, y, width, height }
    this.isSelecting = false;
    this.isDraggingBox = false;
    this.isResizingBox = false;
    this.activeHandle = null;
    this.dragStart = { x: 0, y: 0 };
    this.boxStart = { x: 0, y: 0, w: 0, h: 0 };
    this.scale = 1;

    // Font and typography options
    this.settings = {
      fontFamily: "'Patrick Hand', cursive",
      color: "#0f172a", // Dark charcoal
      sizeScale: 0.95,
      fontWeight: "normal",
      autoLineHeight: true,
      backgroundColor: "#ffffff"
    };

    this.onApplyCallback = null;
  }

  init(containerElement, sourceCanvas, onApply) {
    this.stageContainer = containerElement;
    this.onApplyCallback = onApply;

    // Make an unblemished backup of the original document
    this.originalCanvas = document.createElement('canvas');
    this.originalCanvas.width = sourceCanvas.width;
    this.originalCanvas.height = sourceCanvas.height;
    const origCtx = this.originalCanvas.getContext('2d');
    origCtx.drawImage(sourceCanvas, 0, 0);

    // Working canvas holds the rendered result
    this.workingCanvas = document.createElement('canvas');
    this.workingCanvas.width = sourceCanvas.width;
    this.workingCanvas.height = sourceCanvas.height;
    const workCtx = this.workingCanvas.getContext('2d');
    workCtx.drawImage(sourceCanvas, 0, 0);

    // Overlay canvas for interactive selection box and highlight bounds
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'ocr-overlay-canvas';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.stageContainer.innerHTML = '';
    this.stageContainer.appendChild(this.workingCanvas);
    this.stageContainer.appendChild(this.overlayCanvas);

    this.lines = [];
    this.selectedBox = null;

    this.updateOverlaySize();
    this.setupInteractions();
    this.render();
  }

  updateOverlaySize() {
    if (!this.workingCanvas || !this.overlayCanvas) return;
    this.overlayCanvas.width = this.workingCanvas.width;
    this.overlayCanvas.height = this.workingCanvas.height;
  }

  setupInteractions() {
    const canvas = this.overlayCanvas;
    if (!canvas) return;

    const getCanvasPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
        clientX,
        clientY
      };
    };

    const isNear = (x1, y1, x2, y2, radius = 24) => Math.hypot(x1 - x2, y1 - y2) <= radius;

    const onPointerDown = (e) => {
      const pos = getCanvasPos(e);
      this.dragStart = { x: pos.x, y: pos.y };

      // Check if user clicked a resize handle of existing selection box
      if (this.selectedBox) {
        const { x, y, width: w, height: h } = this.selectedBox;
        const handles = [
          { name: 'tl', x, y },
          { name: 'tr', x: x + w, y },
          { name: 'br', x: x + w, y: y + h },
          { name: 'bl', x, y: y + h }
        ];

        for (const hnd of handles) {
          if (isNear(pos.x, pos.y, hnd.x, hnd.y)) {
            this.isResizingBox = true;
            this.activeHandle = hnd.name;
            this.boxStart = { ...this.selectedBox };
            e.preventDefault();
            return;
          }
        }

        // Check if user clicked inside the selection box to move it
        if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
          this.isDraggingBox = true;
          this.boxStart = { ...this.selectedBox };
          e.preventDefault();
          return;
        }
      }

      // Check if user clicked a converted text line to edit it
      const clickedLine = this.findLineAt(pos.x, pos.y);
      if (clickedLine) {
        this.openInlineTextEditor(clickedLine, pos.clientX, pos.clientY);
        return;
      }

      // Otherwise start drawing a new selection box
      this.isSelecting = true;
      this.selectedBox = { x: pos.x, y: pos.y, width: 0, height: 0 };
      this.render();
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      const pos = getCanvasPos(e);

      if (this.isSelecting && this.selectedBox) {
        const minX = Math.min(this.dragStart.x, pos.x);
        const minY = Math.min(this.dragStart.y, pos.y);
        const w = Math.abs(pos.x - this.dragStart.x);
        const h = Math.abs(pos.y - this.dragStart.y);
        this.selectedBox = {
          x: Math.max(0, minX),
          y: Math.max(0, minY),
          width: Math.min(this.workingCanvas.width - minX, w),
          height: Math.min(this.workingCanvas.height - minY, h)
        };
        this.renderOverlay();
        e.preventDefault();
      } else if (this.isDraggingBox && this.selectedBox) {
        const dx = pos.x - this.dragStart.x;
        const dy = pos.y - this.dragStart.y;
        this.selectedBox.x = Math.max(0, Math.min(this.workingCanvas.width - this.selectedBox.width, this.boxStart.x + dx));
        this.selectedBox.y = Math.max(0, Math.min(this.workingCanvas.height - this.selectedBox.height, this.boxStart.y + dy));
        this.renderOverlay();
        e.preventDefault();
      } else if (this.isResizingBox && this.selectedBox) {
        this.handleResize(pos.x, pos.y);
        this.renderOverlay();
        e.preventDefault();
      }
    };

    const onPointerUp = () => {
      if (this.isSelecting && this.selectedBox) {
        if (this.selectedBox.width < 15 || this.selectedBox.height < 15) {
          // Box is too tiny; clear it
          this.selectedBox = null;
        }
      }
      this.isSelecting = false;
      this.isDraggingBox = false;
      this.isResizingBox = false;
      this.activeHandle = null;
      this.renderOverlay();
    };

    canvas.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  }

  handleResize(currX, currY) {
    const s = this.boxStart;
    if (this.activeHandle === 'br') {
      this.selectedBox.width = Math.max(20, currX - s.x);
      this.selectedBox.height = Math.max(20, currY - s.y);
    } else if (this.activeHandle === 'tr') {
      const newY = Math.min(currY, s.y + s.h - 20);
      this.selectedBox.y = newY;
      this.selectedBox.height = (s.y + s.h) - newY;
      this.selectedBox.width = Math.max(20, currX - s.x);
    } else if (this.activeHandle === 'bl') {
      const newX = Math.min(currX, s.x + s.w - 20);
      this.selectedBox.x = newX;
      this.selectedBox.width = (s.x + s.w) - newX;
      this.selectedBox.height = Math.max(20, currY - s.y);
    } else if (this.activeHandle === 'tl') {
      const newX = Math.min(currX, s.x + s.w - 20);
      const newY = Math.min(currY, s.y + s.h - 20);
      this.selectedBox.x = newX;
      this.selectedBox.y = newY;
      this.selectedBox.width = (s.x + s.w) - newX;
      this.selectedBox.height = (s.y + s.h) - newY;
    }
  }

  findLineAt(x, y) {
    return this.lines.find(l => {
      const b = l.bbox;
      return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    });
  }

  // Draw interactive overlay: selection box, resize handles, and converted line bounding highlights
  renderOverlay() {
    if (!this.overlayCtx || !this.overlayCanvas) return;
    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Highlight existing converted text lines subtly
    this.lines.forEach(line => {
      const b = line.bbox;
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      ctx.fillRect(b.x0, b.y0, b.width, b.height);
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(b.x0, b.y0, b.width, b.height);
      ctx.setLineDash([]);
    });

    // Draw active user selection box if present
    if (this.selectedBox && this.selectedBox.width > 5 && this.selectedBox.height > 5) {
      const { x, y, width: bw, height: bh } = this.selectedBox;

      // Darkened backdrop outside selected box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
      ctx.fillRect(0, 0, w, y);
      ctx.fillRect(0, y + bh, w, h - (y + bh));
      ctx.fillRect(0, y, x, bh);
      ctx.fillRect(x + bw, y, w - (x + bw), bh);

      // Selection box border
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, bw, bh);

      // Fill area with subtle blue tint
      ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
      ctx.fillRect(x, y, bw, bh);

      // Draw 4 corner resize handles
      const handleSize = 14;
      const handles = [
        { x, y },
        { x: x + bw, y },
        { x: x + bw, y: y + bh },
        { x, y: y + bh }
      ];

      handles.forEach(hnd => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hnd.x, hnd.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Label
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 12px sans-serif';
      const label = 'Selected Area (Drawings outside remain as-is)';
      const textW = ctx.measureText(label).width;
      ctx.fillRect(x, Math.max(0, y - 22), textW + 12, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + 6, Math.max(14, y - 8));
    }
  }

  // Clear selection box
  clearSelection() {
    this.selectedBox = null;
    this.renderOverlay();
  }

  // Set font settings and re-render converted text lines
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.rebuildWorkingCanvas();
  }

  // Execute OCR and convert text (either whole page or selected area)
  async processConversion(mode = 'selected') {
    const isSelectedMode = mode === 'selected' && this.selectedBox && this.selectedBox.width > 20 && this.selectedBox.height > 20;
    const region = isSelectedMode ? { ...this.selectedBox } : null;

    const imgDataUrl = this.originalCanvas.toDataURL('image/jpeg', 0.95);

    const res = await fetch(SeafileApi.apiUrl ? SeafileApi.apiUrl('/api/ocr') : '/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imgDataUrl,
        region: region
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `OCR failed: HTTP ${res.status}`);
    }

    const ocrResult = await res.json();
    const newLines = ocrResult.lines || [];

    if (newLines.length === 0) {
      return { count: 0, text: '' };
    }

    // Merge or replace lines in the region
    if (isSelectedMode) {
      // Remove any previously recorded lines that overlapped this region
      const box = this.selectedBox;
      this.lines = this.lines.filter(l => {
        const b = l.bbox;
        const overlap = !(b.x1 < box.x || b.x0 > box.x + box.width || b.y1 < box.y || b.y0 > box.y + box.height);
        return !overlap;
      });
      // Add new recognized lines with assigned IDs
      newLines.forEach((l, idx) => {
        l.id = `line_${Date.now()}_${idx}`;
        l.userEdited = false;
        this.lines.push(l);
      });
      // Clear selection box after converting
      this.selectedBox = null;
    } else {
      // All page mode
      this.lines = newLines.map((l, idx) => {
        l.id = `line_${Date.now()}_${idx}`;
        l.userEdited = false;
        return l;
      });
      this.selectedBox = null;
    }

    // Inpaint and render digital font
    this.rebuildWorkingCanvas();
    this.renderOverlay();

    return {
      count: newLines.length,
      text: ocrResult.text || ''
    };
  }

  // Inpaint: Erases handwritten ink in text bounding boxes and renders digital font in-place.
  // Diagrams, drawings, and sketches outside text bounding boxes remain 100% intact!
  rebuildWorkingCanvas() {
    if (!this.workingCanvas || !this.originalCanvas) return;
    const ctx = this.workingCanvas.getContext('2d');

    // 1. Reset to the pristine original document (preserving all sketches, drawings, diagrams)
    ctx.clearRect(0, 0, this.workingCanvas.width, this.workingCanvas.height);
    ctx.drawImage(this.originalCanvas, 0, 0);

    if (this.lines.length === 0) {
      this.renderOverlay();
      return;
    }

    // 2. For each detected handwritten text line:
    this.lines.forEach(line => {
      const textToRender = (line.editedText !== undefined ? line.editedText : line.text).trim();
      if (!textToRender) return;

      const b = line.bbox;
      const padX = Math.max(3, b.width * 0.02);
      const padY = Math.max(3, b.height * 0.08);

      // Clean erase: Inpaint over the handwritten line with paper background color
      ctx.fillStyle = this.settings.backgroundColor || '#ffffff';
      ctx.fillRect(
        Math.max(0, b.x0 - padX),
        Math.max(0, b.y0 - padY),
        b.width + padX * 2,
        b.height + padY * 2
      );

      // Calculate optical font size based on original handwritten bounding box height
      let fontSize = Math.max(12, Math.round(b.height * 0.72 * this.settings.sizeScale));

      // Font configuration
      ctx.font = `${this.settings.fontWeight} ${fontSize}px ${this.settings.fontFamily}`;
      ctx.fillStyle = this.settings.color || '#0f172a';
      ctx.textBaseline = 'middle';

      // Measure text width and scale down if line is longer than original width
      const measuredW = ctx.measureText(textToRender).width;
      if (measuredW > b.width * 1.08 && measuredW > 0) {
        fontSize = Math.max(10, Math.round(fontSize * (b.width / measuredW)));
        ctx.font = `${this.settings.fontWeight} ${fontSize}px ${this.settings.fontFamily}`;
      }

      // Render crisp digital text aligned at the original line vertical center
      const renderY = b.y0 + b.height / 2;
      ctx.fillText(textToRender, b.x0 + 2, renderY);
    });

    this.renderOverlay();
  }

  // Open an inline tooltip editor so the user can quickly correct OCR misreadings
  openInlineTextEditor(line, clientX, clientY) {
    const existing = document.getElementById('ocr-inline-editor');
    if (existing) existing.remove();

    const editor = document.createElement('div');
    editor.id = 'ocr-inline-editor';
    editor.className = 'ocr-inline-editor';

    const currentText = line.editedText !== undefined ? line.editedText : line.text;

    editor.innerHTML = `
      <div class="editor-header">
        <span>✏️ Edit Recognized Line</span>
        <button class="btn-close-mini" id="btn-close-inline">×</button>
      </div>
      <input type="text" id="inline-text-input" class="form-control" value="${this.escapeHtml(currentText)}" autofocus>
      <div class="editor-actions">
        <button id="btn-delete-inline" class="btn btn-secondary btn-sm" title="Revert to original drawing/handwriting">Revert Line</button>
        <button id="btn-save-inline" class="btn btn-primary btn-sm">Update Font</button>
      </div>
    `;

    document.body.appendChild(editor);

    // Position editor near clicked line
    const popW = 280;
    const posX = Math.min(window.innerWidth - popW - 10, Math.max(10, clientX - popW / 2));
    const posY = Math.max(10, clientY - 110);
    editor.style.left = `${posX}px`;
    editor.style.top = `${posY}px`;

    const input = document.getElementById('inline-text-input');
    input?.focus();
    input?.select();

    const saveEdit = () => {
      line.editedText = input.value;
      line.userEdited = true;
      this.rebuildWorkingCanvas();
      editor.remove();
    };

    document.getElementById('btn-save-inline')?.addEventListener('click', saveEdit);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveEdit();
      if (e.key === 'Escape') editor.remove();
    });

    document.getElementById('btn-close-inline')?.addEventListener('click', () => editor.remove());

    document.getElementById('btn-delete-inline')?.addEventListener('click', () => {
      // Remove line so original handwriting/drawing is restored
      this.lines = this.lines.filter(l => l.id !== line.id);
      this.rebuildWorkingCanvas();
      editor.remove();
    });
  }

  escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Revert all changes back to original document
  revertAll() {
    this.lines = [];
    this.selectedBox = null;
    this.rebuildWorkingCanvas();
  }

  // Get full combined text from all recognized blocks
  getFullTranscribedText() {
    return this.lines
      .map(l => (l.editedText !== undefined ? l.editedText : l.text).trim())
      .filter(Boolean)
      .join('\n');
  }

  // Finalize & bake converted font into document canvas
  applyToDocument() {
    if (!this.workingCanvas) return;
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = this.workingCanvas.width;
    outputCanvas.height = this.workingCanvas.height;
    const ctx = outputCanvas.getContext('2d');
    ctx.drawImage(this.workingCanvas, 0, 0);

    if (this.onApplyCallback) {
      this.onApplyCallback(outputCanvas, this.getFullTranscribedText());
    }
    return outputCanvas;
  }

  render() {
    this.rebuildWorkingCanvas();
  }
}

window.HandwritingConverter = HandwritingConverter;
