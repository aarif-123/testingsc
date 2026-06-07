if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch (e) {}
}

const express = require('express');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3002;
const DB_FILE = path.join(__dirname, 'papers_db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// ── DB helpers ────────────────────────────────────────────────────────────────
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { papers: {} }; }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── Parse arXiv Atom XML → clean JSON ────────────────────────────────────────
// xml2js with explicitArray:true wraps ALL fields in arrays — unwrap carefully
function str(v) {
  // Unwrap single-element arrays, then stringify
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object') v = v._ || v['#text'] || '';
  return String(v || '');
}
function parseEntry(e) {
  const rawId = str(e.id);
  const id = rawId.split('/abs/').pop().replace(/v\d+$/, '').trim();

  // Authors: each author element has a name child
  let authorArr = e.author || [];
  if (!Array.isArray(authorArr)) authorArr = [authorArr];
  const authors = authorArr.map(a => str(a.name)).filter(Boolean);

  // Categories: each category element has a $ attribute bag
  let catArr = e.category || [];
  if (!Array.isArray(catArr)) catArr = [catArr];
  const categories = catArr.map(c => {
    const attrs = c?.$ || {};
    return attrs.term || str(c);
  }).filter(Boolean);

  // Published / updated come as ISO strings inside arrays
  const published = str(e.published).substring(0, 10);
  const updated   = str(e.updated).substring(0, 10);

  return {
    id,
    title:      str(e.title).replace(/\s+/g, ' ').trim(),
    authors,
    abstract:   str(e.summary).replace(/\s+/g, ' ').trim(),
    categories,
    published,
    updated,
    arxivUrl:  `https://arxiv.org/abs/${id}`,
    pdfUrl:    `https://arxiv.org/pdf/${id}.pdf`,
    htmlUrl:   `https://ar5iv.labs.arxiv.org/html/${id}`,
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── Rate Limiter ─────────────────────────────────────────────────────────────
const rateLimits = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_CHAT_REQUESTS = 10; // Max 10 requests per minute

function chatRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();

  if (!rateLimits[ip]) rateLimits[ip] = [];
  rateLimits[ip] = rateLimits[ip].filter(time => now - time < RATE_LIMIT_WINDOW);

  if (rateLimits[ip].length >= MAX_CHAT_REQUESTS) {
    const waitSec = Math.ceil((RATE_LIMIT_WINDOW - (now - rateLimits[ip][0])) / 1000);
    res.setHeader('Retry-After', waitSec);
    return res.status(429).json({ error: `Rate limit exceeded. Please wait ${waitSec} seconds before sending another request.` });
  }

  rateLimits[ip].push(now);
  next();
}

// ── SEARCH ───────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q = 'transformer attention', cat, max = 20, start = 0, sort = 'relevance' } = req.query;

    // Build arXiv query string
    let searchQuery = q;
    if (cat && cat !== 'all') {
      searchQuery = `(${searchQuery}) AND cat:${cat}`;
    }

    const sortMap = { relevance: 'relevance', newest: 'submittedDate' };
    const url = [
      'https://export.arxiv.org/api/query',
      `?search_query=${encodeURIComponent(searchQuery)}`,
      `&start=${start}`,
      `&max_results=${max}`,
      `&sortBy=${sortMap[sort] || 'relevance'}`,
      `&sortOrder=descending`,
    ].join('');

    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Aether-Research/2.0 (https://github.com/aether)' },
    });

    const parsed = await parseStringPromise(resp.data, { explicitArray: true });
    const feed = parsed.feed;
    const entries = feed.entry || [];
    const papers = entries.map(parseEntry).filter(p => p.id);

    const totalRaw = feed['opensearch:totalResults']?.[0];
    const total = parseInt(typeof totalRaw === 'object' ? totalRaw._ : totalRaw, 10) || papers.length;

    // Mark which papers are saved locally
    const db = loadDB();
    papers.forEach(p => { p.saved = !!db.papers[p.id]; p.localStatus = db.papers[p.id]?.status; });

    res.json({ papers, total, query: searchQuery });
  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: err.message, papers: [], total: 0 });
  }
});

// ── FETCH SINGLE PAPER by arXiv ID ───────────────────────────────────────────
app.get('/api/arxiv/:id(*)', async (req, res) => {
  try {
    const id = req.params.id;
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
    const resp = await axios.get(url, { timeout: 10000 });
    const parsed = await parseStringPromise(resp.data, { explicitArray: true });
    const entry = parsed.feed.entry?.[0];
    if (!entry) return res.status(404).json({ error: 'Paper not found on arXiv' });
    const paper = parseEntry(entry);
    const db = loadDB();
    paper.saved = !!db.papers[paper.id];
    if (db.papers[paper.id]) Object.assign(paper, db.papers[paper.id]);
    res.json(paper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIST LOCAL LIBRARY ────────────────────────────────────────────────────────
app.get('/api/papers', (req, res) => {
  const db = loadDB();
  const { status, q } = req.query;
  let papers = Object.values(db.papers).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  if (status && status !== 'all') papers = papers.filter(p => p.status === status);
  if (q) {
    const lq = q.toLowerCase();
    papers = papers.filter(p =>
      p.title?.toLowerCase().includes(lq) ||
      p.authors?.join(' ').toLowerCase().includes(lq) ||
      p.abstract?.toLowerCase().includes(lq)
    );
  }
  res.json({ papers, total: papers.length });
});

// ── SAVE PAPER TO LIBRARY ─────────────────────────────────────────────────────
app.post('/api/papers', (req, res) => {
  const db = loadDB();
  const paper = req.body;
  if (!paper.id) return res.status(400).json({ error: 'Paper ID required' });
  db.papers[paper.id] = {
    ...paper,
    savedAt: new Date().toISOString(),
    status: paper.status || 'saved',
    notes: paper.notes || '',
    highlights: paper.highlights || [],
    summary4: paper.summary4 || null,
    tags: paper.tags || [],
  };
  saveDB(db);
  res.json({ success: true, paper: db.papers[paper.id] });
});

// ── GET SINGLE PAPER FROM LIBRARY ─────────────────────────────────────────────
app.get('/api/papers/:id(*)', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  if (!db.papers[id]) return res.status(404).json({ error: 'Paper not in library' });
  res.json(db.papers[id]);
});

// ── UPDATE PAPER ──────────────────────────────────────────────────────────────
app.patch('/api/papers/:id(*)', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  if (!db.papers[id]) return res.status(404).json({ error: 'Paper not in library' });
  db.papers[id] = { ...db.papers[id], ...req.body, updatedAt: new Date().toISOString() };
  saveDB(db);
  res.json({ success: true, paper: db.papers[id] });
});

// ── DELETE PAPER ──────────────────────────────────────────────────────────────
app.delete('/api/papers/:id(*)', (req, res) => {
  const db = loadDB();
  delete db.papers[req.params.id];
  saveDB(db);
  res.json({ success: true });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const papers = Object.values(db.papers);
  res.json({
    total: papers.length,
    saved: papers.filter(p => p.status === 'saved').length,
    reading: papers.filter(p => p.status === 'reading').length,
    done: papers.filter(p => p.status === 'done').length,
  });
});

// ── SETTINGS (Groq API key etc.) ─────────────────────────────────────────────
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); }

// ── API KEY ROTATION & COOLDOWNS ─────────────────────────────────────────────
const keyCooldowns = {};
const COOLDOWN_DURATION = 60 * 1000; // 1 minute cooldown

function getAPIKeys() {
  const s = loadSettings();
  const keys = [];

  if (s.groqApiKey) {
    keys.push(s.groqApiKey);
  }
  if (process.env.GROQ_API_KEYS) {
    const envKeys = process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
    keys.push(...envKeys);
  }
  if (process.env.GROQ_API_KEY) {
    keys.push(process.env.GROQ_API_KEY);
  }

  return [...new Set(keys)];
}

app.get('/api/settings', (req, res) => {
  const s = loadSettings();
  const key = s.groqApiKey || process.env.GROQ_API_KEY || '';
  res.json({ hasGroqKey: !!key, keyPreview: key ? `${key.substring(0, 8)}...${key.slice(-4)}` : null });
});

app.post('/api/settings', (req, res) => {
  const s = loadSettings();
  if (req.body.groqApiKey !== undefined) s.groqApiKey = req.body.groqApiKey.trim();
  saveSettings(s);
  const key = s.groqApiKey;
  res.json({ success: true, hasGroqKey: !!key, keyPreview: key ? `${key.substring(0, 8)}...${key.slice(-4)}` : null });
});

// ── AI CHAT  ─  Streams Groq LLaMA-3.3-70b ───────────────────────────────────
const SYSTEM_PROMPTS = {
  chat: (ctx) => `You are a brilliant, knowledgeable research assistant helping a scientist understand a paper.

Paper you are discussing:
${ctx}

Your guidelines:
- Answer based on the paper's content; be precise
- Explain maths and algorithms clearly — use notation when helpful
- Acknowledge uncertainty honestly — don't invent details
- Use **markdown** formatting: bold key terms, use \`code\` for symbols, use bullet lists
- Be conversational but rigorous`,

  implement: (ctx) => `You are an expert ML engineer who translates research papers into clean, working Python code.

Paper to implement:
${ctx}

Your task: generate a COMPLETE, RUNNABLE Python implementation of the core algorithm/architecture.

Requirements:
1. Use PyTorch (preferred) or NumPy as appropriate
2. Write EXTENSIVE inline comments — every non-trivial line explained
3. Reference paper sections/equations in comments (e.g., "# Eq. 3 in paper")
4. End with a self-contained demonstration that a user can run immediately
5. For neural architectures: instantiate the model and run a sample forward pass with realistic tensor shapes
6. For algorithms: show step-by-step execution on a small example

Code structure:
\`\`\`python
# <Paper Title> — PyTorch Implementation
# Reference: <arXiv ID>
# Implements: <what specifically>

import torch
...
\`\`\`

After the code, write 2-3 sentences on: what you implemented and how to adapt it.`,

  analyze: (ctx) => `You are a rigorous academic peer reviewer analyzing a research paper with scholarly precision.

Paper:
${ctx}

Provide a structured critical analysis:

**1. Core Contribution**  
What is genuinely novel vs. incremental?

**2. Technical Soundness**  
Are the methods valid? Any questionable assumptions?

**3. Experimental Rigor**  
Are the evaluations convincing? Baselines fair? Ablations sufficient?

**4. Claims vs. Evidence**  
What is well-supported? What is hand-wavy or unsubstantiated?

**5. Practical Impact**  
Real-world applicability? What would it take to use this in production?

**6. Open Questions**  
What does this paper leave unanswered? Best follow-up directions?

Be specific and cite aspects of the abstract/methodology.`,
};

app.post('/api/chat', chatRateLimiter, async (req, res) => {
  const { messages = [], paper, mode = 'chat' } = req.body;
  const keys = getAPIKeys();
  if (keys.length === 0) {
    return res.status(401).json({ error: 'Groq API key not set. Click ⚙ Settings in the sidebar to add your key.' });
  }

  // Build paper context string
  const paperCtx = paper ? [
    `Title: ${paper.title}`,
    `Authors: ${(paper.authors || []).slice(0, 6).join(', ')}`,
    `Published: ${paper.published || 'N/A'}`,
    `arXiv ID: ${paper.id || 'N/A'}`,
    `Categories: ${(paper.categories || []).join(', ')}`,
    `Abstract:\n${(paper.abstract || '').substring(0, 2500)}`,
  ].join('\n') : '(no paper context provided)';

  const promptFn = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.chat;
  const systemPrompt = promptFn(paperCtx);
  const maxTokens = mode === 'implement' ? 4096 : 2048;
  const temperature = mode === 'implement' ? 0.15 : 0.65;
  const modelName = mode === 'implement' ? 'openai/gpt-oss-120b' : 'llama-3.3-70b-versatile';

  // Key rotation logic
  let lastErr = null;
  let success = false;

  // Filter keys not on cooldown
  let activeKeys = keys.filter(k => {
    const blockedAt = keyCooldowns[k];
    if (blockedAt && Date.now() - blockedAt < COOLDOWN_DURATION) {
      return false;
    }
    return true;
  });

  if (activeKeys.length === 0) {
    // If all keys are on cooldown, clear them to try again (recovery fallback)
    activeKeys = keys;
  }

  for (const apiKey of activeKeys) {
    try {
      console.log(`[Groq API] Attempting request with key preview: ${apiKey.substring(0, 8)}...`);
      const groqResp = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: modelName,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          stream: true,
          max_tokens: maxTokens,
          temperature,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          responseType: 'stream',
          timeout: 90000,
        }
      );

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let buf = '';
      groqResp.data.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          if (t === 'data: [DONE]') { res.write('data: [DONE]\n\n'); return; }
          if (t.startsWith('data: ')) res.write(t + '\n\n');
        }
      });
      groqResp.data.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
      groqResp.data.on('error', err => { console.error('[stream err]', err.message); res.end(); });
      req.on('close', () => { try { groqResp.data.destroy(); } catch {} });
      
      success = true;
      break; // Request succeeded, exit loop
    } catch (err) {
      const status = err.response?.status;
      lastErr = err;
      
      if (status === 429) {
        console.warn(`[Groq API] Key ${apiKey.substring(0, 8)}... rate limited (429). Rotating key...`);
        keyCooldowns[apiKey] = Date.now();
        continue;
      }
      
      if (status === 401) {
        console.warn(`[Groq API] Key ${apiKey.substring(0, 8)}... unauthorized (401). Rotating key...`);
        continue;
      }
      
      break; // Other error, exit loop
    }
  }

  if (!success && lastErr) {
    const status = lastErr.response?.status || 500;
    const msg = lastErr.response?.data?.error?.message || lastErr.message;
    console.error('[/api/chat] All attempts failed:', msg);
    if (!res.headersSent) res.status(status).json({ error: msg });
    else res.end();
  }
});

// ── EXTRACT DATASETS ──────────────────────────────────────────────────────────
app.post('/api/datasets', chatRateLimiter, async (req, res) => {
  const { title, abstract } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Paper title required' });
  }

  const keys = getAPIKeys();
  if (keys.length === 0) {
    return res.status(401).json({ error: 'Groq API key not set. Add it in settings.' });
  }

  const systemPrompt = `You are an expert ML research data librarian. Identify all datasets, benchmarks, or corpuses mentioned in the paper title and abstract. For each dataset:
1. "name": E.g. "SQuAD v2.0"
2. "task": The primary ML task evaluated (e.g. "Question Answering")
3. "url": Typical dataset link (e.g. Hugging Face Datasets link or official repository)
4. "pythonCode": A copyable, clean python code block to load or download it (e.g. using 'datasets.load_dataset' or 'torchvision.datasets' or standard urllib/git clone code).

Return a JSON object with a single "datasets" array containing these objects. Return ONLY the JSON object. Do not wrap it in markdown formatting.`;
  const userPrompt = `Paper Title: ${title}\nPaper Abstract: ${abstract}`;

  let lastErr = null;
  let success = false;

  let activeKeys = keys.filter(k => {
    const blockedAt = keyCooldowns[k];
    if (blockedAt && Date.now() - blockedAt < COOLDOWN_DURATION) {
      return false;
    }
    return true;
  });
  if (activeKeys.length === 0) activeKeys = keys;

  for (const apiKey of activeKeys) {
    try {
      console.log(`[Groq API Datasets] Attempting request with key preview: ${apiKey.substring(0, 8)}...`);
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 1500
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const data = response.data?.choices?.[0]?.message?.content;
      let parsed = { datasets: [] };
      try {
        parsed = JSON.parse(data);
      } catch (parseErr) {
        console.error('[datasets parse err]', parseErr.message);
      }

      res.json(parsed);
      success = true;
      break;
    } catch (err) {
      const status = err.response?.status;
      lastErr = err;
      if (status === 429) {
        console.warn(`[Groq API Datasets] Key ${apiKey.substring(0, 8)}... rate limited. Rotating...`);
        keyCooldowns[apiKey] = Date.now();
        continue;
      }
      if (status === 401) {
        console.warn(`[Groq API Datasets] Key ${apiKey.substring(0, 8)}... unauthorized. Rotating...`);
        continue;
      }
      break;
    }
  }

  if (!success && lastErr) {
    const status = lastErr.response?.status || 500;
    const msg = lastErr.response?.data?.error?.message || lastErr.message;
    res.status(status).json({ error: msg, datasets: [] });
  }
});

// ── RUN PYTHON CODE ───────────────────────────────────────────────────────────
const { exec } = require('child_process');

app.post('/api/run-code', chatRateLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const tempDir = path.join(__dirname, 'temp_runs');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filename = `run_${Date.now()}_${Math.floor(Math.random() * 1000)}.py`;
  const filePath = path.join(tempDir, filename);

  // Write the code to a temporary file
  try {
    fs.writeFileSync(filePath, code, 'utf8');
  } catch (writeErr) {
    return res.status(500).json({ error: `Failed to create file: ${writeErr.message}` });
  }

  const startTime = Date.now();
  // Execute using Python
  const childProcess = exec(`python "${filePath}"`, { timeout: 10000 }, (error, stdout, stderr) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Clean up the temp file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupErr) {
      console.error('[cleanup err]', cleanupErr.message);
    }

    if (error && error.killed) {
      return res.json({
        stdout,
        stderr: stderr || 'Error: Process exceeded the 10-second timeout limit and was terminated.',
        exitCode: -1,
        duration,
        timeout: true
      });
    }

    res.json({
      stdout,
      stderr,
      exitCode: error ? (error.code || 1) : 0,
      duration,
      timeout: false
    });
  });
});

// ── TRACE PYTHON CODE ────────────────────────────────────────────────────────
app.post('/api/trace-code', chatRateLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const tempDir = path.join(__dirname, 'temp_runs');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const codeFilename = `trace_code_${Date.now()}_${Math.floor(Math.random() * 1000)}.py`;
  const codeFilePath = path.join(tempDir, codeFilename);

  const tracerFilename = `tracer_${Date.now()}_${Math.floor(Math.random() * 1000)}.py`;
  const tracerFilePath = path.join(tempDir, tracerFilename);

  // Write user code to run
  try {
    fs.writeFileSync(codeFilePath, code, 'utf8');
  } catch (writeErr) {
    return res.status(500).json({ error: `Failed to create code file: ${writeErr.message}` });
  }

  // Write Python settrace wrapper script
  const tracerScript = `
import sys
import json
import traceback

code_path = sys.argv[1]
with open(code_path, 'r', encoding='utf-8') as f:
    user_code = f.read()

steps = []

class CaptureOutput:
    def __init__(self, original):
        self.original = original
        self.buffer = []
    def write(self, text):
        self.buffer.append(text)
    def flush(self):
        pass

capture_stdout = CaptureOutput(sys.stdout)
sys.stdout = capture_stdout

def trace_lines(frame, event, arg):
    # Only trace code from exec string scope
    if frame.f_code.co_filename != '<string>':
        return trace_lines
        
    if event == 'line':
        local_vars = {}
        for k, v in frame.f_locals.items():
            if k.startswith('__') or k in ['sys', 'json', 'traceback', 'capture_stdout']:
                continue
            
            var_type = type(v).__name__
            
            if isinstance(v, (int, float, str, bool)) or v is None:
                local_vars[k] = {"type": var_type, "value": v}
            elif hasattr(v, 'shape'):
                try:
                    shape = list(v.shape)
                    if hasattr(v, 'detach'):
                        t = v.detach().cpu()
                        if len(t.shape) == 0:
                            flat = [t.item()]
                        else:
                            flat = t.numpy().flatten().tolist()
                    else:
                        flat = v.flatten().tolist()
                    local_vars[k] = {
                        "type": var_type,
                        "value": f"Tensor {shape}",
                        "shape": shape,
                        "sample": flat[:24]
                    }
                except Exception as e:
                    local_vars[k] = {"type": var_type, "value": str(v)}
            elif isinstance(v, (list, tuple)):
                try:
                    sample = [x if isinstance(x, (int, float, str, bool)) else str(x) for x in v[:24]]
                    local_vars[k] = {
                        "type": var_type,
                        "value": f"{var_type.capitalize()} of length {len(v)}",
                        "sample": sample
                    }
                except:
                    local_vars[k] = {"type": var_type, "value": str(v)}
            else:
                local_vars[k] = {"type": var_type, "value": str(v)}

        steps.append({
            "line": frame.f_lineno,
            "vars": local_vars,
            "output": "".join(capture_stdout.buffer)
        })
    return trace_lines

try:
    compiled = compile(user_code, '<string>', 'exec')
    sys.settrace(trace_lines)
    global_scope = {}
    local_scope = {}
    exec(compiled, global_scope, local_scope)
    sys.settrace(None)
    
    sys.stdout = capture_stdout.original
    print(json.dumps({
        "success": True,
        "steps": steps
    }))
except Exception as err:
    sys.settrace(None)
    sys.stdout = capture_stdout.original
    tb = traceback.format_exc()
    print(json.dumps({
        "success": False,
        "error": str(err),
        "traceback": tb,
        "steps": steps
    }))
`;

  try {
    fs.writeFileSync(tracerFilePath, tracerScript, 'utf8');
  } catch (writeErr) {
    try { fs.unlinkSync(codeFilePath); } catch {}
    return res.status(500).json({ error: `Failed to create tracer file: ${writeErr.message}` });
  }

  // Execute using Python (10s timeout limit)
  const childProcess = exec(`python "${tracerFilePath}" "${codeFilePath}"`, { timeout: 10000 }, (error, stdout, stderr) => {
    // Clean up temp files
    try {
      if (fs.existsSync(codeFilePath)) fs.unlinkSync(codeFilePath);
      if (fs.existsSync(tracerFilePath)) fs.unlinkSync(tracerFilePath);
    } catch (cleanupErr) {
      console.error('[trace cleanup err]', cleanupErr.message);
    }

    if (error && error.killed) {
      return res.json({
        success: false,
        error: 'Execution exceeded the 10-second timeout limit and was terminated.',
        steps: []
      });
    }

    try {
      const result = JSON.parse(stdout.trim());
      res.json(result);
    } catch (parseErr) {
      res.json({
        success: false,
        error: stderr || stdout || 'Failed to execute or parse trace output.',
        steps: []
      });
    }
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ✦  Aether Research Platform  v3`);
  console.log(`     ────────────────────────────`);
  console.log(`     http://localhost:${PORT}`);
  console.log(`     arXiv proxy + Groq LLaMA 70B ready\n`);
});
