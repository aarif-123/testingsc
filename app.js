// ── Aether — Main Application ─────────────────────────────────────────────
import {
  RESEARCHER, PAPERS, ALERTS, MONITORS, FEED_ITEMS, LIT_CLUSTERS, PAPER_SECTIONS
} from "./data.js";
import { KnowledgeGraph } from "./graph.js";

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
const state = {
  activeScreen: "feed",
  activeReader: PAPERS[0],             // paper currently open in reader
  activeReaderTab: "highlights",
  graphInstance: null,
  selectedCluster: LIT_CLUSTERS[0].id,
  draftContent: {},                    // clusterId → text
  highlightMenuVisible: false,
  summary4Modal: false,
  flyoutPaper: null,                   // paper shown in graph flyout
  abstractText: MONITORS.find(m => m.type === "abstract")?.query || "",
  nicheScore: 84,
  readingStartTime: Date.now(),
};

// Init draft content from cluster data
LIT_CLUSTERS.forEach(c => {
  state.draftContent[c.id] = c.draft;
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER — navigate between screens
// ═══════════════════════════════════════════════════════════════════════════
function navigateTo(screenId) {
  state.activeScreen = screenId;

  // Update nav items
  document.querySelectorAll(".nav-item[data-screen]").forEach(item => {
    item.classList.toggle("active", item.dataset.screen === screenId);
  });

  // Toggle screens
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.toggle("active", s.id === `screen-${screenId}`);
  });

  // Post-navigation hooks
  if (screenId === "graph") {
    initGraph();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 1 — MORNING FEED
// ═══════════════════════════════════════════════════════════════════════════
function renderFeed() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Main greeting
  document.getElementById("feed-greeting-name").textContent = `${greeting}, ${RESEARCHER.name.split(" ")[0]}.`;
  document.getElementById("feed-date-line").textContent = dateStr.toUpperCase();

  // Render signal cards
  renderFeedSignals();

  // Render new papers section
  renderNewPapersSection();

  // Render sidebar
  renderFeedSidebar();
}

function renderFeedSignals() {
  const container = document.getElementById("feed-signals");
  container.innerHTML = "";

  FEED_ITEMS.forEach((item, i) => {
    let card;
    if (item.type === "threat") {
      card = renderThreatCard(item);
    } else if (item.type === "validates") {
      card = renderValidatesCard(item);
    }
    if (card) {
      card.style.animationDelay = `${i * 60}ms`;
      card.classList.add("anim-in");
      container.appendChild(card);
    }
  });
}

function renderThreatCard(item) {
  const div = document.createElement("div");
  div.className = "signal-card threat";
  div.innerHTML = `
    <div class="signal-card-header">
      <div class="signal-type threat">
        <div class="signal-type-dot pulse"></div>
        THREAT DETECTED
      </div>
      <span class="signal-timestamp">${item.timestamp}</span>
    </div>
    <div class="signal-paper-title">${item.paperTitle}</div>
    <div class="signal-description">
      A new paper may directly overlap with your current research niche.
      Review immediately — this is a potential priority conflict.
    </div>
    <div class="similarity-bar">
      <span class="similarity-label">Abstract similarity</span>
      <div class="similarity-track">
        <div class="similarity-fill high" style="width: ${item.similarity}%"></div>
      </div>
      <span class="similarity-value high">${item.similarity}%</span>
    </div>
  `;
  div.addEventListener("click", () => navigateTo("monitor"));
  return div;
}

function renderValidatesCard(item) {
  const div = document.createElement("div");
  div.className = "signal-card validates";
  div.innerHTML = `
    <div class="signal-card-header">
      <div class="signal-type validates">
        <div class="signal-type-dot"></div>
        HYPOTHESIS VALIDATED
      </div>
      <span class="signal-timestamp">${item.timestamp}</span>
    </div>
    <div class="signal-paper-title">${item.paperTitle}</div>
    <div class="signal-description">
      A paper aligned with your saved work gained significant traction this week.
      <strong style="color: var(--green)">${item.metric}</strong> — the community is moving in your direction.
    </div>
  `;
  const paper = PAPERS.find(p => p.id === item.paperId);
  if (paper) div.addEventListener("click", () => openReader(paper));
  return div;
}

function renderNewPapersSection() {
  const newItem = FEED_ITEMS.find(i => i.type === "new");
  if (!newItem) return;

  const container = document.getElementById("feed-new-papers");
  const paperIds = newItem.papers;

  container.innerHTML = `
    <div class="new-papers-header">
      <div class="feed-section-label" style="margin:0">
        NEW IN EFFICIENT ATTENTION — SINCE ${newItem.since.toUpperCase()}
      </div>
      <span class="chip chip-accent">${newItem.count} papers</span>
    </div>
    ${paperIds.map(pid => {
      const p = PAPERS.find(pp => pp.id === pid);
      if (!p) return "";
      const labmateAvatars = p.labmateReads.map(initials => {
        const lm = RESEARCHER.labmates.find(l => l.initials === initials);
        return lm ? `<span class="labmate-avatar" style="background:${lm.color};width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#090C11;margin-left:-4px">${initials}</span>` : "";
      }).join("");

      return `
        <div class="paper-row" data-paper="${p.id}">
          <div class="paper-row-status ${p.status}"></div>
          <div style="flex:1;min-width:0">
            <div class="paper-row-title">${p.title}</div>
            <div class="paper-row-meta">${p.authors[0]}${p.authors.length > 1 ? ` et al.` : ""} · ${p.venue}</div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            ${labmateAvatars}
          </div>
        </div>
      `;
    }).join("")}
  `;

  container.querySelectorAll(".paper-row[data-paper]").forEach(row => {
    row.addEventListener("click", () => {
      const p = PAPERS.find(pp => pp.id === row.dataset.paper);
      if (p) openReader(p);
    });
  });
}

function renderFeedSidebar() {
  // Progress ring
  const read = RESEARCHER.papersToday;
  const target = RESEARCHER.paperTarget;
  const pct = read / target;
  const r = 18, circ = 2 * Math.PI * r;
  const dash = circ * pct;

  document.getElementById("progress-ring-svg").innerHTML = `
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3"/>
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="#4A90D9" stroke-width="3"
      stroke-dasharray="${dash} ${circ}"
      stroke-dashoffset="${circ * 0.25}"
      stroke-linecap="round"/>
  `;
  document.getElementById("progress-count").textContent = read;
  document.getElementById("progress-target").textContent = `/ ${target} papers today`;

  // Streak
  document.getElementById("streak-number").textContent = RESEARCHER.streak;

  // Unread queue
  const unreadContainer = document.getElementById("unread-queue");
  const unreadPapers = PAPERS.filter(p => p.status === "unread");
  unreadContainer.innerHTML = unreadPapers.map(p => `
    <div class="unread-item" data-paper="${p.id}">
      <div class="unread-item-title">${p.title}</div>
      <div class="unread-item-authors">${p.authors[0]}${p.authors.length > 1 ? " et al." : ""} · ${p.year}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
        ${p.tags.slice(0, 3).map(t => `<span class="chip chip-default">${t}</span>`).join("")}
      </div>
      <div class="unread-progress">
        <div class="unread-progress-fill" style="width:${p.progress || 0}%"></div>
      </div>
    </div>
  `).join("");

  unreadContainer.querySelectorAll(".unread-item").forEach(item => {
    item.addEventListener("click", () => {
      const p = PAPERS.find(pp => pp.id === item.dataset.paper);
      if (p) openReader(p);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 2 — DEEP READER
// ═══════════════════════════════════════════════════════════════════════════
function openReader(paper) {
  state.activeReader = paper;
  state.readingStartTime = Date.now();
  navigateTo("reader");
  renderReader();
}

function renderReader() {
  const paper = state.activeReader;
  if (!paper) return;

  // Topbar
  document.getElementById("reader-paper-title-bar").textContent = paper.title;
  document.getElementById("reader-arxiv").textContent = `arXiv:${paper.arxivId}`;

  // Paper column
  renderPaperText(paper);

  // Workspace
  renderWorkspace(paper);

  // Context panel
  renderContextPanel(paper);

  // Reading speed bar
  updateReadingSpeed();

  // Start reading speed timer
  if (state._speedTimer) clearInterval(state._speedTimer);
  state._speedTimer = setInterval(updateReadingSpeed, 5000);
}

function renderPaperText(paper) {
  const col = document.getElementById("paper-text-col");
  const sections = PAPER_SECTIONS[paper.id] || [
    { id: "abstract", title: "Abstract", summary: "AI summary not available for this section." }
  ];

  // Section nav pills
  const navHtml = sections.map((s, i) => `
    <button class="section-nav-btn ${i === 0 ? "active" : ""}" data-section="${s.id}">${s.title}</button>
  `).join("");

  // Sections
  const sectionsHtml = sections.map((s, i) => {
    const bodyText = getSectionBody(paper, s.id);
    return `
      <div class="paper-section" id="section-${s.id}">
        <div class="section-header">
          <h2 class="section-title">${s.title}</h2>
          <button class="section-summary-toggle" data-section="${s.id}">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M8 3v10M4 7l4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            AI summary
          </button>
        </div>
        <div class="section-ai-summary ${i === 0 ? "" : "hidden"}" id="summary-${s.id}">
          ${s.summary}
        </div>
        <div class="paper-body-text">${bodyText}</div>
      </div>
    `;
  }).join("");

  col.innerHTML = `
    <h1 class="paper-title-main">${paper.title}</h1>
    <div class="paper-authors-main">${paper.authors.join(", ")}</div>
    <div class="paper-venue-main">${paper.venue} · ${paper.year} · arXiv:${paper.arxivId}</div>

    <div class="paper-section-nav">${navHtml}</div>
    ${sectionsHtml}
  `;

  // Section nav click → scroll
  col.querySelectorAll(".section-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      col.querySelectorAll(".section-nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(`section-${btn.dataset.section}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // AI summary toggles
  col.querySelectorAll(".section-summary-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const summary = document.getElementById(`summary-${btn.dataset.section}`);
      if (summary) summary.classList.toggle("hidden");
    });
  });

  // Text selection → highlight menu
  col.addEventListener("mouseup", onTextSelection);
}

function getSectionBody(paper, sectionId) {
  // Return realistic body text with pre-applied highlights
  const bodies = {
    "s1": `We present <span class="highlight-result">FlashAttention-3, which introduces new techniques to speed up attention on GPUs</span> that have asynchrony between different types of operations as well as supports for FP8 low-precision. We propose three main ideas: exploiting <span class="highlight-method">asynchrony of the Tensor Cores and TMA to overlap computation and data movement via warp-specialization</span>; interleaving block-wise matmul and softmax operations; and incoherent processing that leverages hardware support for FP8 quantization. Together, <span class="highlight-result">FlashAttention-3 reaches 740–1090 TFLOPS/s on H100 GPUs, 1.5-2.0× faster than FlashAttention-2</span>.`,

    "s2": `Attention is <span class="highlight-limitation">memory bandwidth-bound on modern GPU hardware</span> — the fundamental bottleneck is not compute, but the bandwidth required to read and write the attention matrix between HBM and SRAM. Prior work (FlashAttention, FlashAttention-2) addressed this through IO-aware tiling strategies. However, <span class="highlight-claim">the asynchrony between different compute units on H100 GPUs remains underexplored</span> as a source of additional speedup. Specifically, the Tensor Memory Accelerator (TMA) enables software-initiated, hardware-executed memory transfers that can overlap with computation — but this requires careful orchestration at the warp level.`,

    "s3": `The H100 GPU introduces several new hardware primitives relevant to our work. The <span class="highlight-method">Tensor Memory Accelerator (TMA) is a hardware unit that handles memory transfers autonomously</span>, freeing compute SMs from memory-copy instructions. Warp groups can be specialized to different roles — some warps execute tensor operations while others initiate memory transfers simultaneously. This architecture demands new software abstractions that don't exist in standard GPU programming models.`,

    "s4": `FlashAttention-3 introduces three synergistic techniques. First, <span class="highlight-method">warp-specialization: we partition warp groups into "producer" warps that issue TMA loads and "consumer" warps that execute WGMMA tensor operations</span>, enabling true overlap of computation and memory movement. Second, we interleave softmax and matrix-multiply operations such that neither unit is idle. Third, we use incoherent FP8 processing: instead of requiring exact quantization, we apply random hadamard transforms to make quantization error statistically uniform, enabling <span class="highlight-result">FP8 precision with perplexity parity to BF16</span>.`,

    "s5": `We benchmark FlashAttention-3 on H100 SXM5 GPUs. For forward pass attention, FA3 achieves <span class="highlight-result">740-1090 TFLOPS/s depending on sequence length and head dimension, compared to 520 TFLOPS/s for FlashAttention-2</span> — a 1.5-2.0× improvement. At FP8 precision, FA3 reaches the highest throughputs while maintaining perplexity equivalent to BF16 baselines on standard language modeling benchmarks.`,

    "s6": `This work builds directly on FlashAttention (Dao et al., 2022) and FlashAttention-2 (Dao, 2023). Concurrent work on efficient attention includes linear attention approximations (Katharopoulos et al., 2020; Choromanski et al., 2021), sparse attention (Child et al., 2019), and state-space alternatives (Gu et al., 2023). <span class="highlight-limitation">Most prior work focuses on algorithmic complexity reduction rather than hardware-level optimization</span> — our approach is complementary and orthogonal to these directions.`,

    "s7": `We have demonstrated that <span class="highlight-claim">hardware-software co-design is the most direct path to attention efficiency on modern accelerators</span>. The H100 architecture exposes enough programmability that careful exploitation of asynchrony can yield substantial gains without algorithmic changes. We expect similar gains are achievable on future GPU generations that continue the trend of separating compute and memory units.`,
  };

  return bodies[sectionId] || paper.abstract || "Section content not available.";
}

function onTextSelection(e) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.toString().trim().length < 10) {
    hideHighlightMenu();
    return;
  }

  const selectedText = sel.toString().trim();
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  showHighlightMenu(rect.left + rect.width / 2, rect.bottom + 8, selectedText);
}

function showHighlightMenu(x, y, text) {
  const menu = document.getElementById("highlight-menu");
  menu.classList.add("show");

  // Position
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(x - 100, window.innerWidth - 220);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${y}px`;

  // Set up actions
  menu.querySelector("[data-action='explain']").onclick = () => {
    showToast(`Explaining: "${text.substring(0, 50)}…"`);
    hideHighlightMenu();
  };
  menu.querySelector("[data-action='contradict']").onclick = () => {
    showToast("Finding papers that contradict this claim…");
    hideHighlightMenu();
  };
  menu.querySelector("[data-action='litreview']").onclick = () => {
    showToast("Added to lit review workspace.");
    hideHighlightMenu();
  };
  menu.querySelector("[data-action='baseline']").onclick = () => {
    showToast("Marked as baseline comparison target.");
    hideHighlightMenu();
  };
}

function hideHighlightMenu() {
  document.getElementById("highlight-menu")?.classList.remove("show");
}

function renderWorkspace(paper) {
  renderHighlightsTab(paper);
  renderSummaryTab(paper);

  // Tab switching
  document.querySelectorAll(".workspace-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".workspace-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeReaderTab = tab.dataset.tab;
      document.querySelectorAll(".workspace-pane").forEach(p => {
        p.style.display = p.dataset.tab === tab.dataset.tab ? "block" : "none";
      });
    });
  });
}

function renderHighlightsTab(paper) {
  const pane = document.getElementById("pane-highlights");
  if (!paper.highlights || paper.highlights.length === 0) {
    pane.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
      <div>No highlights yet.</div>
      <div style="font-size:11px;margin-top:4px">Select text in the paper to highlight it.</div>
    </div>`;
    return;
  }

  pane.innerHTML = paper.highlights.map(h => `
    <div class="highlight-item">
      <div class="highlight-item-type">
        <div style="display:flex;align-items:center;gap:5px">
          <div class="hl-type-dot ${h.type}"></div>
          <span class="hl-type-label ${h.type}">${h.type.toUpperCase()}</span>
        </div>
      </div>
      <div class="highlight-item-text">"${h.text}"</div>
      ${h.note ? `<div class="highlight-item-note">📝 ${h.note}</div>` : ""}
    </div>
  `).join("");
}

function renderSummaryTab(paper) {
  const pane = document.getElementById("pane-summary");

  if (paper.summary4) {
    pane.innerHTML = `
      <div class="summary4-card">
        <div class="summary4-header">4-QUESTION SUMMARY</div>
        <div class="summary4-item">
          <div class="summary4-label">Core Claim</div>
          <div class="summary4-text">${paper.summary4.claim}</div>
        </div>
        <div class="summary4-item">
          <div class="summary4-label">Method</div>
          <div class="summary4-text">${paper.summary4.method}</div>
        </div>
        <div class="summary4-item">
          <div class="summary4-label">Dataset / Benchmark</div>
          <div class="summary4-text">${paper.summary4.dataset}</div>
        </div>
        <div class="summary4-item">
          <div class="summary4-label">Limitation</div>
          <div class="summary4-text">${paper.summary4.limitation}</div>
        </div>
      </div>
      <button class="btn btn-ghost" style="width:100%" id="btn-edit-summary">Edit Summary</button>
    `;
    document.getElementById("btn-edit-summary")?.addEventListener("click", () => openSummary4Modal(paper));
  } else {
    pane.innerHTML = `
      <div style="text-align:center;padding:24px 16px">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;line-height:1.5">
          Capture this paper in 90 seconds. You'll thank yourself in 3 weeks.
        </div>
        <button class="btn btn-primary" id="btn-fill-summary" style="width:100%;justify-content:center">
          Fill 4-Question Summary
        </button>
      </div>
    `;
    document.getElementById("btn-fill-summary")?.addEventListener("click", () => openSummary4Modal(paper));
  }
}

function renderContextPanel(paper) {
  // Novelty score
  const noveltyPct = Math.round(paper.noveltyScore * 100);
  let noveltyDesc = noveltyPct > 70
    ? "High novelty — deep read recommended"
    : noveltyPct > 40
    ? "Moderate novelty — skim, then decide"
    : "Low novelty — likely familiar territory";

  document.getElementById("novelty-value").textContent = `${noveltyPct}%`;
  document.getElementById("novelty-desc").textContent = noveltyDesc;
  document.getElementById("novelty-fill").style.width = `${noveltyPct}%`;

  // Papers this cites (in library)
  const citedInLibrary = (paper.citations || []).map(id => PAPERS.find(p => p.id === id)).filter(Boolean);
  const citedContainer = document.getElementById("context-cited-list");
  if (citedInLibrary.length === 0) {
    citedContainer.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">No citations in your library yet.</div>`;
  } else {
    citedContainer.innerHTML = citedInLibrary.map(p => `
      <div class="context-paper-item" data-paper="${p.id}">
        <div class="context-paper-icon ${p.status}">${p.status === "read" ? "✓" : "○"}</div>
        <div>
          <div class="context-paper-title">${p.title.substring(0, 50)}${p.title.length > 50 ? "…" : ""}</div>
          <div class="context-paper-year">${p.year} · ${p.venue}</div>
        </div>
      </div>
    `).join("");
    citedContainer.querySelectorAll("[data-paper]").forEach(item => {
      item.addEventListener("click", () => {
        const p = PAPERS.find(pp => pp.id === item.dataset.paper);
        if (p) openReader(p);
      });
    });
  }

  // Similar unread papers
  const similarUnread = (paper.similarTo || [])
    .map(id => PAPERS.find(p => p.id === id))
    .filter(p => p && p.status === "unread")
    .slice(0, 3);

  const similarContainer = document.getElementById("context-similar-list");
  similarContainer.innerHTML = similarUnread.length === 0
    ? `<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">No similar unread papers found.</div>`
    : similarUnread.map(p => `
      <div class="context-paper-item" data-paper="${p.id}">
        <div class="context-paper-icon unread">→</div>
        <div>
          <div class="context-paper-title">${p.title.substring(0, 50)}${p.title.length > 50 ? "…" : ""}</div>
          <div class="context-paper-year">${p.year} · ${p.venue}</div>
        </div>
      </div>
    `).join("");

  similarContainer.querySelectorAll("[data-paper]").forEach(item => {
    item.addEventListener("click", () => {
      const p = PAPERS.find(pp => pp.id === item.dataset.paper);
      if (p) openReader(p);
    });
  });

  // Labmate reads
  const labContainer = document.getElementById("context-labmates");
  if (paper.labmateReads && paper.labmateReads.length > 0) {
    labContainer.innerHTML = paper.labmateReads.map(initials => {
      const lm = RESEARCHER.labmates.find(l => l.initials === initials);
      return lm ? `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="width:24px;height:24px;border-radius:50%;background:${lm.color};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#090C11">${initials}</div>
        <span style="font-size:12px;color:var(--text-secondary)">${lm.name}</span>
        <span class="chip chip-green" style="margin-left:auto">Read</span>
      </div>` : "";
    }).join("");
  } else {
    labContainer.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary)">No labmates have read this yet.</div>`;
  }
}

function updateReadingSpeed() {
  const elapsed = (Date.now() - state.readingStartTime) / 1000 / 60; // minutes
  const pagesRead = Math.max(0.5, elapsed * 1.8); // simulate reading rate
  const speed = (pagesRead / Math.max(0.1, elapsed)).toFixed(1);
  const remaining = Math.max(0, Math.round(12 - elapsed));

  const speedEl = document.getElementById("reading-speed-value");
  const remEl = document.getElementById("reading-time-remaining");
  if (speedEl) speedEl.textContent = `${speed} pages/min`;
  if (remEl) remEl.textContent = `~${remaining} min remaining`;
}

// ── Summary4 Modal ──────────────────────────────────────────────────────────
function openSummary4Modal(paper) {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.add("open");

  document.getElementById("modal-title").textContent = "4-Question Summary";
  document.getElementById("modal-subtitle").textContent =
    `${paper.title.substring(0, 60)}… · Takes about 90 seconds`;

  const q = paper.summary4 || {};
  document.getElementById("modal-q-claim").value = q.claim || "";
  document.getElementById("modal-q-method").value = q.method || "";
  document.getElementById("modal-q-dataset").value = q.dataset || "";
  document.getElementById("modal-q-limitation").value = q.limitation || "";

  document.getElementById("modal-save").onclick = () => {
    paper.summary4 = {
      claim: document.getElementById("modal-q-claim").value,
      method: document.getElementById("modal-q-method").value,
      dataset: document.getElementById("modal-q-dataset").value,
      limitation: document.getElementById("modal-q-limitation").value,
    };
    overlay.classList.remove("open");
    renderSummaryTab(paper);
    showToast("Summary saved. ✓");
  };

  document.getElementById("modal-cancel").onclick = () => overlay.classList.remove("open");
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 3 — KNOWLEDGE GRAPH
// ═══════════════════════════════════════════════════════════════════════════
function initGraph() {
  const canvas = document.getElementById("graph-canvas");
  if (!canvas) return;

  // Resize canvas to container
  const resizeCanvas = () => {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    if (state.graphInstance) {
      state.graphInstance.initPositions();
      state.graphInstance.render();
    }
  };

  if (!state.graphInstance) {
    resizeCanvas();
    state.graphInstance = new KnowledgeGraph(canvas, PAPERS, onGraphNodeClick);
    state.graphInstance.fitToScreen();
    window.addEventListener("resize", resizeCanvas);
  } else {
    resizeCanvas();
    state.graphInstance.render();
  }

  // Time slider
  const slider = document.getElementById("time-slider");
  const yearLabel = document.getElementById("time-slider-year");
  if (slider) {
    slider.value = 2025;
    yearLabel.textContent = "2025";
    slider.addEventListener("input", () => {
      const year = parseInt(slider.value);
      yearLabel.textContent = year;
      state.graphInstance?.setYearFilter(year);
    });
  }

  // Controls
  document.getElementById("graph-zoom-in")?.addEventListener("click", () => state.graphInstance?.zoomIn());
  document.getElementById("graph-zoom-out")?.addEventListener("click", () => state.graphInstance?.zoomOut());
  document.getElementById("graph-fit")?.addEventListener("click", () => state.graphInstance?.fitToScreen());
}

function onGraphNodeClick(paper) {
  state.flyoutPaper = paper;
  const flyout = document.getElementById("graph-flyout");
  flyout.classList.add("open");
  renderGraphFlyout(paper);
}

function renderGraphFlyout(paper) {
  const flyout = document.getElementById("graph-flyout");

  const statusColor = paper.status === "read" ? "var(--green)" : "var(--accent)";
  const statusLabel = paper.status === "read" ? "✓ Read & annotated" : "● Unread";

  flyout.innerHTML = `
    <button class="flyout-close" id="flyout-close">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M12 4L4 12M4 4l8 8" stroke-linecap="round"/></svg>
    </button>

    <div style="margin-top:8px">
      <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:12px">
        <span class="chip chip-default">${paper.year}</span>
        <span style="font-size:11px;color:${statusColor};font-weight:500">${statusLabel}</span>
      </div>

      <h2 style="font-size:15px;font-weight:600;color:var(--text-primary);line-height:1.4;margin-bottom:8px">${paper.title}</h2>
      <div style="font-size:12px;color:var(--accent);margin-bottom:4px">${paper.authors.join(", ")}</div>
      <div style="font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono);margin-bottom:16px">${paper.venue}</div>

      <div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:16px">
        ${paper.abstract.substring(0, 220)}…
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px">
        ${paper.tags.map(t => `<span class="chip chip-default">${t}</span>`).join("")}
      </div>

      ${paper.highlights && paper.highlights.length > 0 ? `
        <div style="margin-bottom:16px">
          <div class="context-section-title">YOUR HIGHLIGHTS</div>
          ${paper.highlights.slice(0, 2).map(h => `
            <div style="padding:8px;background:var(--bg-overlay);border-radius:var(--r-sm);margin-bottom:6px;font-size:12px;color:var(--text-secondary);border-left:2px solid ${h.type === 'result' ? 'var(--green)' : h.type === 'method' ? 'var(--purple)' : 'var(--accent)'}">
              "${h.text}"
            </div>
          `).join("")}
        </div>
      ` : ""}

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="flyout-open-reader" style="flex:1;justify-content:center">
          Open in Reader
        </button>
        <button class="btn btn-ghost" id="flyout-view-on-arxiv">
          arXiv ↗
        </button>
      </div>
    </div>
  `;

  document.getElementById("flyout-close").onclick = () => {
    flyout.classList.remove("open");
  };
  document.getElementById("flyout-open-reader").onclick = () => {
    flyout.classList.remove("open");
    openReader(paper);
  };
  document.getElementById("flyout-view-on-arxiv").onclick = () => {
    window.open(`https://arxiv.org/abs/${paper.arxivId}`, "_blank");
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 4 — LIT REVIEW WORKSPACE
// ═══════════════════════════════════════════════════════════════════════════
function renderLitReview() {
  renderClusterPanel();
  renderDraftPanel();
  renderCoverageMap();
}

function renderClusterPanel() {
  const container = document.getElementById("lit-clusters");
  container.innerHTML = LIT_CLUSTERS.map(cluster => {
    const papers = cluster.papers.map(id => PAPERS.find(p => p.id === id)).filter(Boolean);
    const isSelected = cluster.id === state.selectedCluster;

    return `
      <div class="cluster-card ${isSelected ? "selected" : ""}" data-cluster="${cluster.id}">
        <div class="cluster-header">
          <div class="cluster-color" style="background:${cluster.color}"></div>
          <div class="cluster-name">${cluster.name}</div>
          <div class="cluster-count">${papers.length}</div>
        </div>
        <div class="cluster-papers">
          ${papers.map(p => `
            <div class="cluster-paper-item" data-paper="${p.id}">
              <div class="cluster-paper-dot" style="background:${cluster.color}"></div>
              <span>${p.title.substring(0, 38)}${p.title.length > 38 ? "…" : ""}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Cluster click → highlight draft paragraph
  container.querySelectorAll(".cluster-card").forEach(card => {
    card.addEventListener("click", () => {
      state.selectedCluster = card.dataset.cluster;
      renderClusterPanel();
      highlightDraftSection(card.dataset.cluster);
    });
  });

  // Paper click within cluster → open reader
  container.querySelectorAll(".cluster-paper-item[data-paper]").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = PAPERS.find(pp => pp.id === item.dataset.paper);
      if (p) openReader(p);
    });
  });
}

function renderDraftPanel() {
  const container = document.getElementById("lit-draft");
  container.innerHTML = LIT_CLUSTERS.map(cluster => {
    const isActive = cluster.id === state.selectedCluster;
    return `
      <div class="draft-paragraph ${isActive ? "highlighted" : ""}" data-cluster="${cluster.id}">
        <div class="draft-cluster-label">
          <div class="draft-cluster-dot" style="background:${cluster.color}"></div>
          <span style="color:${cluster.color};font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase">${cluster.name}</span>
        </div>
        <div
          class="draft-text"
          contenteditable="true"
          id="draft-${cluster.id}"
          spellcheck="true"
        >${state.draftContent[cluster.id]}</div>
      </div>
    `;
  }).join("");

  // Listen for edits → update coverage map
  document.querySelectorAll(".draft-text[contenteditable]").forEach(el => {
    el.addEventListener("input", () => {
      const clusterId = el.id.replace("draft-", "");
      state.draftContent[clusterId] = el.textContent;
      renderCoverageMap();
    });
  });
}

function highlightDraftSection(clusterId) {
  document.querySelectorAll(".draft-paragraph").forEach(p => {
    p.classList.toggle("highlighted", p.dataset.cluster === clusterId);
  });
  const target = document.querySelector(`.draft-paragraph[data-cluster="${clusterId}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderCoverageMap() {
  const container = document.getElementById("coverage-map");

  // Check which papers are mentioned in draft
  const allDraftText = Object.values(state.draftContent).join(" ").toLowerCase();

  const allPapers = LIT_CLUSTERS.flatMap(c => c.papers)
    .map(id => PAPERS.find(p => p.id === id))
    .filter(Boolean);

  const usedCount = allPapers.filter(p => {
    return p.authors.some(a => allDraftText.includes(a.split(" ").pop().toLowerCase()))
      || allDraftText.includes(p.title.substring(0, 10).toLowerCase());
  }).length;

  container.innerHTML = `
    <div class="sidebar-section-title">COVERAGE MAP</div>
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
      <span style="color:var(--text-primary);font-weight:600;font-family:var(--font-mono)">${usedCount}/${allPapers.length}</span>
      papers cited in draft
    </div>
    ${allPapers.map(p => {
      const mentioned = p.authors.some(a => allDraftText.includes(a.split(" ").pop().toLowerCase()))
        || allDraftText.includes(p.title.substring(0, 10).toLowerCase());
      return `
        <div class="coverage-paper-item">
          <div class="coverage-indicator ${mentioned ? "used" : "unused"}"></div>
          <div class="coverage-paper-name">${p.authors[0].split(" ").pop()} et al. ${p.year}</div>
        </div>
      `;
    }).join("")}

    <div style="margin-top:16px">
      <div class="sidebar-section-title">EXPORT</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <button class="btn btn-ghost" style="justify-content:center" onclick="exportBibTeX()">
          Export BibTeX
        </button>
        <button class="btn btn-ghost" style="justify-content:center" onclick="exportLaTeX()">
          Export LaTeX
        </button>
      </div>
    </div>
  `;
}

window.exportBibTeX = function () {
  const bibtex = PAPERS.map(p => {
    const key = `${p.authors[0].split(" ").pop().toLowerCase()}${p.year}`;
    return `@article{${key},\n  title={${p.title}},\n  author={${p.authors.join(" and ")}},\n  year={${p.year}},\n  journal={${p.venue}}\n}`;
  }).join("\n\n");

  const blob = new Blob([bibtex], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "aether_bibliography.bib"; a.click();
  showToast("BibTeX exported.");
};

window.exportLaTeX = function () {
  const tex = LIT_CLUSTERS.map(c => {
    return `\\subsection{${c.name}}\n${state.draftContent[c.id] || ""}`;
  }).join("\n\n");

  const blob = new Blob([tex], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "related_work.tex"; a.click();
  showToast("LaTeX exported.");
};

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 5 — MONITOR & ALERTS
// ═══════════════════════════════════════════════════════════════════════════
function renderMonitor() {
  renderMonitorList();
  renderAlertFeed();
  renderAbstractPanel();
}

function renderMonitorList() {
  const container = document.getElementById("monitor-list");
  container.innerHTML = MONITORS.map((m, i) => `
    <div class="monitor-item ${i === 0 ? "active" : ""}" data-monitor="${m.id}">
      <div class="monitor-item-header">
        <div class="monitor-item-name">${m.name}</div>
        <span class="monitor-type-chip ${m.type}">${m.type}</span>
      </div>
      ${m.alertCount > 0 ? `
        <div style="font-size:12px;color:var(--red);font-weight:500;margin-bottom:6px">
          ${m.alertCount} new alert${m.alertCount > 1 ? "s" : ""}
        </div>
      ` : ""}
      <div class="monitor-item-stats">
        ${m.weeklyVolume !== null ? `
          <div class="monitor-stat">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 17l6-6 4 4 8-8"/></svg>
            ${m.weeklyVolume}/wk
          </div>
        ` : ""}
        <div class="trend-indicator ${m.trend}">
          ${m.trend === "rising" ? "↑ Rising" : "→ Stable"}
        </div>
        ${m.alertCount > 0 ? `<span class="monitor-alert-count">${m.alertCount}</span>` : ""}
      </div>
      ${m.type === "abstract" && m.similarityHistory ? `
        <div class="similarity-sparkline">
          ${m.similarityHistory.map(val => {
            const color = val > 70 ? "#E05C5C" : val > 40 ? "#D4A843" : "#4CAF8A";
            return `<div class="sparkline-bar" style="height:${Math.round((val/100)*36)}px;background:${color}"></div>`;
          }).join("")}
        </div>
      ` : ""}
    </div>
  `).join("");

  // + New Monitor button
  container.innerHTML += `
    <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px" id="btn-new-monitor">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
      New Monitor
    </button>
  `;

  document.getElementById("btn-new-monitor")?.addEventListener("click", () => {
    showToast("Monitor configuration coming soon.");
  });
}

function renderAlertFeed() {
  const container = document.getElementById("alerts-feed");
  container.innerHTML = `
    <div class="topbar-title" style="font-size:16px;color:var(--text-primary);margin-bottom:4px">Alerts</div>
    <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:20px">${ALERTS.filter(a => !a.read).length} unread · ${ALERTS.length} total</div>
  ` + ALERTS.map(alert => `
    <div class="alert-card ${alert.severity} ${alert.read ? "" : "unread"}">
      <div class="alert-card-header">
        <span class="alert-severity-badge ${alert.severity}">${alert.severityLabel}</span>
        <div class="alert-content">
          <div class="alert-title">${alert.title}</div>
          <div class="alert-paper-title">${alert.paper}</div>
          <div class="alert-authors">${alert.authors.join(", ")} · arXiv:${alert.arxivId}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="alert-timestamp">${alert.detectedAt}</div>
          ${!alert.read ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--accent);margin:4px 0 0 auto"></div>' : ""}
        </div>
      </div>
      <div class="alert-card-body">
        ${alert.reason}
        ${alert.similarity ? `
          <div class="similarity-bar" style="margin-top:10px">
            <span class="similarity-label">Similarity</span>
            <div class="similarity-track">
              <div class="similarity-fill ${alert.similarity > 70 ? "high" : "med"}" style="width:${alert.similarity}%"></div>
            </div>
            <span class="similarity-value ${alert.similarity > 70 ? "high" : "med"}">${alert.similarity}%</span>
          </div>
        ` : ""}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary" style="font-size:11px;padding:5px 10px">Read Paper</button>
          <button class="btn btn-ghost" style="font-size:11px;padding:5px 10px">Dismiss</button>
          ${!alert.read ? '<button class="btn btn-ghost" style="font-size:11px;padding:5px 10px">Mark Read</button>' : ""}
        </div>
      </div>
    </div>
  `).join("");
}

function renderAbstractPanel() {
  const panel = document.getElementById("abstract-panel");

  panel.innerHTML = `
    <div class="sidebar-section-title" style="margin-bottom:12px">ABSTRACT SIMILARITY MONITOR</div>
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
      Paste your draft abstract. It never leaves your browser. Aether scores new papers against it daily.
    </div>
    <textarea
      class="abstract-input"
      id="abstract-input"
      placeholder="Paste your draft abstract here…"
      rows="6"
    >${state.abstractText}</textarea>

    <div class="niche-meter" style="margin-top:12px">
      <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:10px">NICHE SCORE</div>
      <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px">
        <div>
          <div class="niche-score" id="niche-score-val" style="color:var(--red)">${state.nicheScore}%</div>
          <div class="niche-label">max similarity this month</div>
        </div>
        <div style="flex:1;text-align:right;font-size:11px;color:var(--text-tertiary)">
          vs 24 new papers
        </div>
      </div>

      <div class="niche-interpretation crowded" id="niche-interpretation">
        🔴 Crowded lane — review immediately
      </div>

      <div style="margin-top:16px">
        <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">7-DAY HISTORY</div>
        <div class="similarity-sparkline" style="height:48px">
          ${[22, 18, 31, 45, 52, 48, 84].map(val => {
            const color = val > 70 ? "#E05C5C" : val > 40 ? "#D4A843" : "#4CAF8A";
            return `<div class="sparkline-bar" style="height:${Math.round((val/100)*44)}px;background:${color};opacity:0.8"></div>`;
          }).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);margin-top:4px;font-family:var(--font-mono)">
          <span>7d ago</span><span>Today</span>
        </div>
      </div>
    </div>
  `;

  // Abstract input → update niche score
  document.getElementById("abstract-input")?.addEventListener("input", (e) => {
    state.abstractText = e.target.value;
    // Simulate dynamic scoring
    const len = e.target.value.length;
    const score = len > 100 ? Math.min(84, Math.floor(20 + Math.random() * 64)) : 0;
    updateNicheScore(score);
  });
}

function updateNicheScore(score) {
  state.nicheScore = score;
  const el = document.getElementById("niche-score-val");
  const interp = document.getElementById("niche-interpretation");
  if (!el || !interp) return;

  el.textContent = `${score}%`;

  if (score >= 80) {
    el.style.color = "var(--red)";
    interp.className = "niche-interpretation crowded";
    interp.textContent = "🔴 Crowded lane — review immediately";
  } else if (score >= 50) {
    el.style.color = "var(--yellow)";
    interp.className = "niche-interpretation contested";
    interp.textContent = "🟡 Contested territory — monitor closely";
  } else {
    el.style.color = "var(--green)";
    interp.className = "niche-interpretation clear";
    interp.textContent = "🟢 Clear lane — you have room to work";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function showToast(message) {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--bg-overlay);
    color: var(--text-primary);
    padding: 10px 20px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    font-size: 13px;
    font-family: var(--font-sans);
    z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    transition: all 0.2s ease;
    opacity: 0;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(20px)";
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
function init() {
  // Wire up nav items
  document.querySelectorAll(".nav-item[data-screen]").forEach(item => {
    item.addEventListener("click", () => {
      const screen = item.dataset.screen;
      navigateTo(screen);
      if (screen === "litreview") renderLitReview();
      if (screen === "monitor") renderMonitor();
    });
  });

  // Close highlight menu on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#highlight-menu") && !e.target.closest(".paper-body-text")) {
      hideHighlightMenu();
    }
  });

  // Initial renders
  renderFeed();

  // Start on feed
  navigateTo("feed");

  // Expose globals so inline onclick attrs in HTML work
  window._showToast = showToast;
  window._openSummary4Modal = () => openSummary4Modal(state.activeReader);
  window.navigateTo = navigateTo;

  // Draft word count update when switching to lit review
  const origNavTo = navigateTo;
}

document.addEventListener("DOMContentLoaded", init);
