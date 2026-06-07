// ── Aether Knowledge Graph — Canvas Renderer ─────────────────────────────
// Pure canvas, no D3 dependency. Designed for:
//   - Node-by-node reveal via time slider
//   - Gap detection (orange nodes = unread but highly cited)
//   - Click → flyout panel
//   - Hover → tooltip
//   - Drag nodes

export class KnowledgeGraph {
  constructor(canvas, papers, onNodeClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.papers = papers;
    this.onNodeClick = onNodeClick;

    // Viewport state
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isDragging = false;
    this.dragTarget = null;     // paper being dragged
    this.panStart = null;       // pan drag start
    this.hoveredNode = null;

    // Layout
    this.nodePositions = {};    // id → {x, y}
    this.yearFilter = 2025;     // show papers up to this year

    // Build initial positions
    this.initPositions();

    // Events
    this.canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
    this.canvas.addEventListener("mousemove", this.onMouseMove.bind(this));
    this.canvas.addEventListener("mouseup", this.onMouseUp.bind(this));
    this.canvas.addEventListener("mouseleave", this.onMouseLeave.bind(this));
    this.canvas.addEventListener("wheel", this.onWheel.bind(this), { passive: false });
    this.canvas.addEventListener("click", this.onClick.bind(this));

    this.render();
  }

  initPositions() {
    // Use paper's pre-set x,y, then spread them out nicely
    // Scale from compact coordinates to canvas-friendly spread
    const scaleX = 1.4;
    const scaleY = 1.4;
    const centerX = 150;
    const centerY = 80;

    this.papers.forEach(p => {
      this.nodePositions[p.id] = {
        x: (p.x - centerX) * scaleX + this.canvas.width / 2 - 80,
        y: (p.y - centerY) * scaleY + this.canvas.height / 2 - 60,
      };
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.initPositions();
    this.render();
  }

  // ── Filtering ───────────────────────────────────────────────────────────
  getVisiblePapers() {
    return this.papers.filter(p => p.year <= this.yearFilter);
  }

  getNodeRadius(paper) {
    // Count how many of YOUR papers cite this paper
    const citationCount = this.papers.filter(p =>
      p.citations && p.citations.includes(paper.id)
    ).length;
    return Math.max(14, Math.min(30, 14 + citationCount * 5));
  }

  getNodeColor(paper) {
    // Orange: not in library but cited by multiple papers
    const isMissing = !this.papers.find(p => p.id === paper.id);
    if (isMissing) return "#E8874A";

    // Red: contradicts a highlight
    // (simplified: flag manually in data)
    if (paper._contradicts) return "#E05C5C";

    // Blue: read and annotated
    if (paper.status === "read" && paper.highlights && paper.highlights.length > 0) {
      return "#4A90D9";
    }

    // Green: read but not annotated
    if (paper.status === "read") return "#4CAF8A";

    // Gray: saved, unread
    return "#3A4A5C";
  }

  getNodeBorder(paper) {
    if (paper.status === "read") return "rgba(255,255,255,0.2)";
    return "rgba(255,255,255,0.08)";
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  render() {
    const { ctx, canvas, scale, offsetX, offsetY } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background grid
    this.drawGrid();

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const visible = this.getVisiblePapers();

    // Draw edges first (behind nodes)
    this.drawEdges(visible);

    // Draw nodes
    visible.forEach(paper => {
      this.drawNode(paper);
    });

    ctx.restore();
  }

  drawGrid() {
    const { ctx, canvas } = this;
    ctx.strokeStyle = "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;

    const gridSize = 50;
    const startX = this.offsetX % gridSize;
    const startY = this.offsetY % gridSize;

    for (let x = startX; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = startY; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  drawEdges(papers) {
    const { ctx } = this;

    papers.forEach(paper => {
      const fromPos = this.nodePositions[paper.id];
      if (!fromPos) return;

      // Citation edges (solid)
      if (paper.citations) {
        paper.citations.forEach(targetId => {
          const targetPaper = papers.find(p => p.id === targetId);
          if (!targetPaper) return;
          const toPos = this.nodePositions[targetId];
          if (!toPos) return;

          ctx.save();
          ctx.strokeStyle = "rgba(74,144,217,0.15)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);

          // Draw curved edge
          ctx.beginPath();
          const cx = (fromPos.x + toPos.x) / 2;
          const cy = (fromPos.y + toPos.y) / 2 - 20;
          ctx.moveTo(fromPos.x, fromPos.y);
          ctx.quadraticCurveTo(cx, cy, toPos.x, toPos.y);
          ctx.stroke();
          ctx.restore();
        });
      }

      // Semantic similarity edges (dashed)
      if (paper.similarTo) {
        paper.similarTo.forEach(targetId => {
          // Only draw if not already a citation edge
          if (paper.citations && paper.citations.includes(targetId)) return;
          const targetPaper = papers.find(p => p.id === targetId);
          if (!targetPaper) return;
          const toPos = this.nodePositions[targetId];
          if (!toPos) return;

          // Only draw once per pair
          if (paper.id > targetId) return;

          ctx.save();
          ctx.strokeStyle = "rgba(124,106,247,0.12)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 6]);

          ctx.beginPath();
          ctx.moveTo(fromPos.x, fromPos.y);
          ctx.lineTo(toPos.x, toPos.y);
          ctx.stroke();
          ctx.restore();
        });
      }
    });
  }

  drawNode(paper) {
    const { ctx } = this;
    const pos = this.nodePositions[paper.id];
    if (!pos) return;

    const r = this.getNodeRadius(paper);
    const color = this.getNodeColor(paper);
    const isHovered = this.hoveredNode === paper.id;

    // Glow for hovered
    if (isHovered) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);

    // Gradient fill
    const gradient = ctx.createRadialGradient(
      pos.x - r * 0.3, pos.y - r * 0.3, 0,
      pos.x, pos.y, r
    );
    gradient.addColorStop(0, color + "CC");
    gradient.addColorStop(1, color + "66");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Border
    ctx.strokeStyle = isHovered ? color : this.getNodeBorder(paper);
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.stroke();

    if (isHovered) ctx.restore();

    // Unread indicator dot
    if (paper.status === "unread") {
      ctx.beginPath();
      ctx.arc(pos.x + r * 0.6, pos.y - r * 0.6, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#4A90D9";
      ctx.fill();
    }

    // Year label
    ctx.font = `500 ${Math.max(9, Math.min(11, r * 0.5))}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(paper.year, pos.x, pos.y);

    // Title below node
    const shortTitle = paper.title.length > 22
      ? paper.title.substring(0, 22) + "…"
      : paper.title;

    ctx.font = "400 10px Inter, sans-serif";
    ctx.fillStyle = isHovered
      ? "rgba(232,237,243,0.95)"
      : "rgba(138,151,168,0.8)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(shortTitle, pos.x, pos.y + r + 5);
  }

  // ── Hit Testing ─────────────────────────────────────────────────────────
  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.offsetX) / this.scale,
      y: (screenY - this.offsetY) / this.scale,
    };
  }

  getPaperAtPoint(screenX, screenY) {
    const world = this.screenToWorld(screenX, screenY);
    const visible = this.getVisiblePapers();

    // Iterate in reverse so top-rendered nodes get priority
    for (let i = visible.length - 1; i >= 0; i--) {
      const paper = visible[i];
      const pos = this.nodePositions[paper.id];
      if (!pos) continue;
      const r = this.getNodeRadius(paper);
      const dx = world.x - pos.x;
      const dy = world.y - pos.y;
      if (dx * dx + dy * dy <= r * r) return paper;
    }
    return null;
  }

  // ── Event Handlers ──────────────────────────────────────────────────────
  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const paper = this.getPaperAtPoint(x, y);
    if (paper) {
      // Start dragging this node
      this.isDragging = true;
      this.dragTarget = paper;
      this.canvas.style.cursor = "grabbing";
    } else {
      // Start panning
      this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
      this.canvas.style.cursor = "grabbing";
    }
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isDragging && this.dragTarget) {
      // Move the node
      const world = this.screenToWorld(x, y);
      this.nodePositions[this.dragTarget.id] = { x: world.x, y: world.y };
      this.render();
      return;
    }

    if (this.panStart) {
      // Pan the viewport
      this.offsetX = e.clientX - this.panStart.x;
      this.offsetY = e.clientY - this.panStart.y;
      this.render();
      return;
    }

    // Hover detection
    const paper = this.getPaperAtPoint(x, y);
    const newHovered = paper ? paper.id : null;
    if (newHovered !== this.hoveredNode) {
      this.hoveredNode = newHovered;
      this.canvas.style.cursor = paper ? "pointer" : "default";
      this.render();

      // Update tooltip
      this.updateTooltip(paper, e.clientX, e.clientY);
    } else if (this.hoveredNode) {
      this.updateTooltip(paper, e.clientX, e.clientY);
    }
  }

  onMouseUp(e) {
    this.isDragging = false;
    this.dragTarget = null;
    this.panStart = null;
    this.canvas.style.cursor = this.hoveredNode ? "pointer" : "default";
  }

  onMouseLeave() {
    this.hoveredNode = null;
    this.isDragging = false;
    this.dragTarget = null;
    this.panStart = null;
    this.render();
    this.hideTooltip();
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(3, this.scale * delta));

    // Zoom toward mouse position
    this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
    this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;

    this.render();
  }

  onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const paper = this.getPaperAtPoint(x, y);
    if (paper && this.onNodeClick) {
      this.onNodeClick(paper);
    }
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────
  updateTooltip(paper, clientX, clientY) {
    const tooltip = document.getElementById("graph-tooltip");
    if (!tooltip) return;

    if (!paper) {
      this.hideTooltip();
      return;
    }

    tooltip.classList.add("show");
    tooltip.style.left = (clientX + 16) + "px";
    tooltip.style.top = (clientY - 10) + "px";

    const statusLabel = paper.status === "read" ? "✓ Read" : paper.status === "unread" ? "● Unread" : "◐ Reading";
    tooltip.innerHTML = `
      <div class="graph-tooltip-title">${paper.title}</div>
      <div class="graph-tooltip-meta">${paper.authors[0]} et al. · ${paper.year} · ${paper.venue}</div>
      <div class="graph-tooltip-meta" style="margin-top:4px;color:${this.getNodeColor(paper)}">${statusLabel}</div>
    `;
  }

  hideTooltip() {
    const tooltip = document.getElementById("graph-tooltip");
    if (tooltip) tooltip.classList.remove("show");
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  zoomIn() {
    this.scale = Math.min(3, this.scale * 1.2);
    this.render();
  }

  zoomOut() {
    this.scale = Math.max(0.3, this.scale / 1.2);
    this.render();
  }

  fitToScreen() {
    const visible = this.getVisiblePapers();
    if (visible.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visible.forEach(p => {
      const pos = this.nodePositions[p.id];
      if (!pos) return;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x);
      maxY = Math.max(maxY, pos.y);
    });

    const padding = 80;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const scaleX = this.canvas.width / contentW;
    const scaleY = this.canvas.height / contentH;
    this.scale = Math.min(scaleX, scaleY, 1.5);
    this.offsetX = -minX * this.scale + padding * this.scale;
    this.offsetY = -minY * this.scale + padding * this.scale;

    this.render();
  }

  setYearFilter(year) {
    this.yearFilter = year;
    this.render();
  }
}
