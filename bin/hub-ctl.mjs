#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getHubPaths() {
  const rawRoot = process.env.AI_HUB_ROOT
    ? path.resolve(process.env.AI_HUB_ROOT)
    : path.resolve(__dirname, '..');
  const hubRoot = fs.existsSync(rawRoot) ? fs.realpathSync(rawRoot) : rawRoot;
  const configDir = path.join(hubRoot, 'config');
  const adaptersDir = path.join(hubRoot, 'adapters');
  const runtimeDir = path.join(hubRoot, 'runtime');
  const configPath = path.join(configDir, 'slots.json');
  const exampleConfigPath = path.join(configDir, 'slots.example.json');
  return {
    hubRoot,
    configDir,
    adaptersDir,
    runtimeDir,
    configPath,
    exampleConfigPath,
    tasksDir: path.join(runtimeDir, '任务单'),
    deliveriesDir: path.join(runtimeDir, '交付件'),
    reviewsDir: path.join(runtimeDir, '审核单'),
    handoversDir: path.join(runtimeDir, '交接记录'),
    briefingPath: path.join(runtimeDir, '进度简报.md'),
    inboxPath: path.join(runtimeDir, '手机指令箱.md'),
    resultsPath: path.join(runtimeDir, '成品结果.json'),
    tracksPath: path.join(runtimeDir, '主线任务.json'),
    trackOverridesPath: path.join(runtimeDir, '主线目标.json'),
    activeJobsPath: path.join(runtimeDir, '运行中任务.json'),
  };
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function ensureInitialized() {
  const P = getHubPaths();
  for (const dir of [P.configDir, P.runtimeDir, P.tasksDir, P.deliveriesDir, P.reviewsDir, P.handoversDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(P.configPath) && fs.existsSync(P.exampleConfigPath)) {
    fs.copyFileSync(P.exampleConfigPath, P.configPath);
  }
  if (!fs.existsSync(P.briefingPath)) {
    fs.writeFileSync(
      P.briefingPath,
      `# 多 AI 中枢 · 最新进度简报\n\n- 更新时间：${formatLocalTime()}\n- 当前状态：已完成初始化，等待主力 AI 写入首次进度。\n\n> 本文件供远程/手机秘书（如 Grok Bot / 微信机器人）只读汇报进度。\n`,
      'utf8'
    );
  }
  if (!fs.existsSync(P.inboxPath)) {
    fs.writeFileSync(
      P.inboxPath,
      `# 手机指令箱\n\n> 远程/手机秘书可将用户在外下达的需求追加到下方列表，主力 AI 接手后处理并标记完成。\n\n- （暂无待处理远程指令）\n`,
      'utf8'
    );
  }
  return P;
}

export function formatLocalTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function resolveBinary(candidates = []) {
  for (const raw of candidates) {
    const candidate = expandHome(raw);
    if (candidate.includes('/')) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
    const res = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim().split('\n')[0];
    }
  }
  return null;
}

function loadEnvFilesSilently(envFiles = []) {
  const loaded = {};
  for (const raw of envFiles) {
    const fp = expandHome(raw);
    if (!fs.existsSync(fp)) continue;
    try {
      const content = fs.readFileSync(fp, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim().replace(/^export\s+/, '').trim();
        let val = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && val) loaded[key] = val;
      }
    } catch {
      // ignore unreadable env file
    }
  }
  return loaded;
}

export function probeAdapter(adapter) {
  const det = adapter.detect || { type: 'always-ready' };
  if (det.type === 'always-ready') {
    return { status: 'ready', detail: '内置可用', binary: null };
  }
  if (det.type === 'app-bundle') {
    const found = (det.paths || []).map(expandHome).find((p) => fs.existsSync(p));
    return found
      ? { status: 'ready', detail: '已安装', binary: found }
      : { status: 'not_installed', detail: '未安装客户端', binary: null };
  }
  if (det.type === 'binary' || det.type === 'binary-and-env') {
    const binary = resolveBinary(det.binaries || []);
    if (!binary) {
      return { status: 'not_installed', detail: '本机未安装', binary: null };
    }
    if (det.type === 'binary-and-env') {
      const fileEnv = loadEnvFilesSilently(det.envFiles || []);
      const missing = (det.requiredEnv || []).filter((k) => !process.env[k] && !fileEnv[k]);
      if (missing.length > 0) {
        return {
          status: 'missing_key',
          detail: '未配置密钥',
          binary,
        };
      }
      return { status: 'ready', detail: '已就绪', binary };
    }
    return { status: 'ready', detail: '已就绪', binary };
  }
  return { status: 'unknown', detail: '未知检测方式', binary: null };
}

export function loadConfig() {
  const P = ensureInitialized();
  return JSON.parse(fs.readFileSync(P.configPath, 'utf8'));
}

export function saveConfig(cfg) {
  const P = ensureInitialized();
  const tmp = `${P.configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, P.configPath);
}

export function loadAdapters() {
  const P = ensureInitialized();
  const files = fs.readdirSync(P.adaptersDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.example.json'))
    .sort();
  return files.map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(P.adaptersDir, f), 'utf8'));
    const probe = probeAdapter(raw);
    return {
      ...raw,
      status: probe.status,
      statusDetail: probe.detail,
      resolvedBinary: probe.binary,
    };
  });
}

function listRecentFiles(dir, limit = 10) {
  if (!fs.existsSync(dir)) return [];
  const P = getHubPaths();
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.json'))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return {
        name: f,
        relPath: path.relative(P.runtimeDir, full),
        size: st.size,
        mtime: st.mtime.toISOString(),
        mtimeMs: st.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

function cleanMd(str) {
  return String(str || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text, maxLen = 180) {
  const s = cleanMd(text);
  if (!s) return '';
  if (s.length <= maxLen) return s;
  const parts = s.split(/[。；;]/).map((p) => p.trim()).filter(Boolean);
  let out = '';
  for (const p of parts) {
    const next = out ? `${out}；${p}` : p;
    if (next.length > maxLen) break;
    out = next;
  }
  if (out) return out;
  return s.slice(0, maxLen - 1) + '…';
}

function parseBoardMarkdown(mdText) {
  const tracks = [];
  const lines = mdText.split(/\r?\n/);
  let current = null;
  let inMainSection = false;
  let lastBulletGroup = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^##\s+一、/.test(trimmed)) {
      inMainSection = true;
      continue;
    }
    if (inMainSection && /^##\s+/.test(trimmed)) {
      break;
    }
    if (!inMainSection || !trimmed) continue;

    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      if (current) tracks.push(current);
      const rawTitle = cleanMd(h3[1]);
      const priMatch = rawTitle.match(/^(P\d)\s*[｜|·:-]\s*(.+)$/);
      if (!priMatch) {
        current = null;
        lastBulletGroup = null;
        continue;
      }
      const fullTitle = priMatch[2].trim();
      const parenMatch = fullTitle.match(/[（(]([^）)]+)[）)]\s*$/);
      const shortTitle = fullTitle.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
      current = {
        id: `board-${tracks.length + 1}`,
        priority: priMatch[1],
        title: shortTitle || fullTitle,
        fullTitle,
        goal: parenMatch ? `${shortTitle}（${parenMatch[1]}）` : shortTitle,
        latest: '',
        status: '',
        next: '',
        details: [],
        keyFiles: [],
        source: 'board',
      };
      lastBulletGroup = null;
      continue;
    }
    if (!current) continue;

    const backticks = [...rawLine.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const bt of backticks) {
      if ((bt.includes('/') || bt.endsWith('.md') || bt.endsWith('.py') || bt.endsWith('.app')) && !current.keyFiles.includes(bt)) {
        current.keyFiles.push(bt);
      }
    }

    const kvMatch = !/^\s{2,}/.test(rawLine) ? trimmed.match(/^-\s*\*\*([^*]+)\*\*[：:]\s*(.*)$/) : null;
    if (kvMatch) {
      const label = cleanMd(kvMatch[1]);
      const val = cleanMd(kvMatch[2]);
      const group = { label, items: val ? [val] : [] };
      current.details.push(group);
      lastBulletGroup = group;

      if (label.startsWith('现状') && val) {
        if (!current.status) current.status = val;
        current.latest = firstSentence(val, 180);
      } else if (/^(近期必做|近期动作|待观察|下一步)/.test(label) && val && !current.next) {
        current.next = firstSentence(val, 180);
      }
      continue;
    }

    if (lastBulletGroup && (/^-\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed))) {
      const val = cleanMd(trimmed.replace(/^(?:-\s+|\d+\.\s+)/, ''));
      if (val) {
        lastBulletGroup.items.push(val);
        if (lastBulletGroup.label.startsWith('现状')) {
          if (!current.status) current.status = val;
          current.latest = firstSentence(val, 180);
        }
        if (/^(近期必做|近期动作|待观察|下一步)/.test(lastBulletGroup.label)) {
          if (/^\d{1,2}-\d{1,2}\s/.test(val)) {
            current.latest = firstSentence(val, 180);
          } else if (!current.next) {
            current.next = firstSentence(val, 180);
          }
        }
      }
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      const val = cleanMd(trimmed.replace(/^-\s+/, ''));
      if (val) {
        current.details.push({ label: '说明', items: [val] });
        if (!current.status) current.status = val;
        if (!current.latest) current.latest = firstSentence(val, 180);
      }
    }
  }
  if (current) tracks.push(current);
  return tracks;
}

function loadTrackOverrides() {
  const P = ensureInitialized();
  if (!fs.existsSync(P.trackOverridesPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(P.trackOverridesPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function updateTrackMeta({ trackId, title, priority, goal, latest, next }) {
  const P = ensureInitialized();
  const map = loadTrackOverrides();
  const patch = {
    ...(title !== undefined && String(title).trim() ? { title: String(title).trim() } : {}),
    ...(priority !== undefined && String(priority).trim() ? { priority: String(priority).trim() } : {}),
    ...(goal !== undefined ? { goal: String(goal).trim() } : {}),
    ...(latest !== undefined ? { latest: String(latest).trim() } : {}),
    ...(next !== undefined ? { next: String(next).trim() } : {}),
    updatedAt: formatLocalTime(),
  };
  map[trackId] = {
    ...(map[trackId] || {}),
    ...patch,
  };
  fs.writeFileSync(P.trackOverridesPath, JSON.stringify(map, null, 2) + '\n', 'utf8');

  // If this is a custom track in 主线任务.json, keep it in sync as well
  if (fs.existsSync(P.tracksPath)) {
    try {
      const list = JSON.parse(fs.readFileSync(P.tracksPath, 'utf8'));
      if (Array.isArray(list)) {
        const idx = list.findIndex((t) => t.id === trackId);
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            ...(patch.title ? { title: patch.title } : {}),
            ...(patch.priority ? { priority: patch.priority } : {}),
            ...(goal !== undefined ? { goal: patch.goal } : {}),
            ...(latest !== undefined ? { latest: patch.latest, status: patch.latest } : {}),
            ...(next !== undefined ? { next: patch.next } : {}),
            updatedAt: patch.updatedAt,
          };
          fs.writeFileSync(P.tracksPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
        }
      }
    } catch {
      // ignore malformed custom tracks file
    }
  }
  return { ok: true, trackId, meta: map[trackId] };
}

export function loadTracks() {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const workspaceRoot = path.resolve(P.hubRoot, cfg.workspaceRoot || '../..');
  let boardTracks = [];
  if (cfg.boardFile) {
    const bf = path.resolve(workspaceRoot, cfg.boardFile);
    if (fs.existsSync(bf)) {
      try {
        boardTracks = parseBoardMarkdown(fs.readFileSync(bf, 'utf8'));
      } catch {
        boardTracks = [];
      }
    }
  }
  let customTracks = [];
  if (fs.existsSync(P.tracksPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(P.tracksPath, 'utf8'));
      if (Array.isArray(parsed)) customTracks = parsed;
    } catch {
      customTracks = [];
    }
  }
  const priRank = (p) => {
    const m = String(p || '').toUpperCase().match(/^P(\d+)$/);
    return m ? Number(m[1]) : 99;
  };
  const overrides = loadTrackOverrides();
  return [...boardTracks, ...customTracks]
    .filter((t) => !overrides[t.id]?.hidden)
    .map((t) => {
      const ov = overrides[t.id];
      return ov
        ? {
            ...t,
            title: ov.title || t.title,
            priority: ov.priority || t.priority,
            goal: ov.goal || t.goal,
            latest: ov.latest || t.latest,
            next: ov.next || t.next,
            lastConversationId: ov.lastConversationId || t.lastConversationId || null,
          }
        : { ...t, lastConversationId: t.lastConversationId || null };
    })
    .sort((a, b) => priRank(a.priority) - priRank(b.priority));
}

async function archiveConversationById(conversationId) {
  const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!lsAddr || !csrf || !conversationId) return false;
  try {
    const archRes = await fetch(`http://${lsAddr}/product.v1.ConversationService/UpdateConversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrf,
      },
      body: JSON.stringify({
        conversationId,
        annotations: { archived: true },
      }),
    });
    return archRes.ok;
  } catch {
    return false;
  }
}

export async function bindTrackConversation({ trackId, conversationId, archivePrevious = false }) {
  const P = ensureInitialized();
  const id = String(trackId || '').trim();
  const convId = String(conversationId || '').trim();
  if (!id || !convId) return { ok: false, error: '缺少 trackId 或 conversationId' };

  const map = loadTrackOverrides();
  const prevConvId = map[id]?.lastConversationId || null;
  let archivedPreviousId = null;

  if (archivePrevious && prevConvId && prevConvId !== convId) {
    const ok = await archiveConversationById(prevConvId);
    if (ok) archivedPreviousId = prevConvId;
  }

  map[id] = {
    ...(map[id] || {}),
    lastConversationId: convId,
    updatedAt: formatLocalTime(),
  };
  fs.writeFileSync(P.trackOverridesPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
  return { ok: true, trackId: id, conversationId: convId, previousId: prevConvId, archivedPreviousId };
}

export function deleteTrack(trackId) {
  const P = ensureInitialized();
  const id = String(trackId || '').trim();
  if (!id) throw new Error('缺少 trackId');

  let removedCustom = false;
  if (fs.existsSync(P.tracksPath)) {
    try {
      const list = JSON.parse(fs.readFileSync(P.tracksPath, 'utf8'));
      if (Array.isArray(list)) {
        const next = list.filter((t) => t.id !== id);
        if (next.length !== list.length) {
          removedCustom = true;
          fs.writeFileSync(P.tracksPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
        }
      }
    } catch {
      // ignore malformed custom tracks
    }
  }

  const map = loadTrackOverrides();
  if (removedCustom) {
    if (map[id]) {
      delete map[id];
      fs.writeFileSync(P.trackOverridesPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
    }
  } else {
    map[id] = {
      ...(map[id] || {}),
      hidden: true,
      updatedAt: formatLocalTime(),
    };
    fs.writeFileSync(P.trackOverridesPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
  }
  return { ok: true, trackId: id, removedCustom };
}

export function addCustomTrack({ priority = 'P1', title, goal = '', status = '', next = '' }) {
  const P = ensureInitialized();
  let list = [];
  if (fs.existsSync(P.tracksPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(P.tracksPath, 'utf8'));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const item = {
    id: `TRK-${formatStamp()}`,
    priority,
    title: String(title || '').trim() || '新主线任务',
    goal: String(goal || title || '').trim(),
    latest: String(status || '').trim(),
    status: String(status || '').trim(),
    next: String(next || '').trim(),
    details: [],
    keyFiles: [],
    source: 'custom',
    updatedAt: formatLocalTime(),
  };
  list.unshift(item);
  fs.writeFileSync(P.tracksPath, JSON.stringify(list.slice(0, 20), null, 2) + '\n', 'utf8');
  return { ok: true, item };
}

export function loadActiveJobs() {
  const P = ensureInitialized();
  if (!fs.existsSync(P.activeJobsPath)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(P.activeJobsPath, 'utf8'));
    if (!Array.isArray(list)) return [];
    // Prune stale jobs older than 10 minutes
    const now = Date.now();
    return list.filter((j) => (now - (j.startedAtMs || 0)) < 10 * 60 * 1000);
  } catch {
    return [];
  }
}

function saveActiveJobs(list) {
  const P = ensureInitialized();
  fs.writeFileSync(P.activeJobsPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

export function dispatchTaskAsync(opts) {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const slotId = opts.slot || 'worker';
  const slot = cfg.slots[slotId];
  if (!slot) throw new Error(`未知卡槽: ${slotId}`);
  const adapterId = opts.adapter || slot.adapter;
  if (!adapterId || adapterId === 'none') {
    throw new Error(`卡槽「${slot.label}」当前为空，请先插上 AI 模块`);
  }
  const adapters = loadAdapters();
  const adapter = adapters.find((a) => a.id === adapterId);
  if (!adapter || adapter.status !== 'ready') {
    throw new Error(`模块 ${adapter?.name || adapterId} 当前不可用`);
  }

  const jobId = `JOB-${formatStamp()}-${Math.random().toString(36).slice(2, 6)}`;
  const promptFile = path.join(os.tmpdir(), `ai-hub-prompt-${jobId}.txt`);
  fs.writeFileSync(promptFile, String(opts.prompt || '').trim(), 'utf8');

  const jobs = loadActiveJobs();
  const job = {
    jobId,
    title: opts.title || '后台处理任务',
    slot: slotId,
    slotLabel: slot.label,
    adapter: adapter.id,
    adapterName: adapter.name,
    trackId: opts.trackId || null,
    startedAt: formatLocalTime(),
    startedAtMs: Date.now(),
    status: 'running',
  };
  jobs.unshift(job);
  saveActiveJobs(jobs);

  const cliArgs = [
    __filename,
    'dispatch',
    '--slot', slotId,
    '--title', job.title,
    '--mode', opts.mode === 'workspace-write' ? 'workspace-write' : 'read-only',
    '--prompt-file', promptFile,
    '--timeout', String(Number(opts.timeout) || 180),
    '--job-id', jobId,
  ];
  if (opts.noWeb !== false) cliArgs.push('--no-web');
  if (opts.trackId) cliArgs.push('--track-id', opts.trackId);

  const child = spawn(process.execPath, cliArgs, {
    cwd: P.hubRoot,
    env: { ...process.env, AI_HUB_ROOT: P.hubRoot },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  return { ok: true, async: true, job };
}

export function loadResults() {
  const P = ensureInitialized();
  if (!fs.existsSync(P.resultsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(P.resultsPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordResult({ title, summary = '', files = [], by = '主力', runtimeRelPath = null, trackId = null }) {
  const P = ensureInitialized();
  const list = loadResults();
  const normFiles = (Array.isArray(files) ? files : String(files || '').split(','))
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const item = {
    id: `RES-${formatStamp()}`,
    title: title || '未命名成品',
    summary: String(summary || '').trim(),
    files: normFiles,
    by: by || '主力',
    runtimeRelPath: runtimeRelPath || null,
    trackId: trackId || null,
    createdAt: formatLocalTime(),
  };
  list.unshift(item);
  fs.writeFileSync(P.resultsPath, JSON.stringify(list.slice(0, 30), null, 2) + '\n', 'utf8');
  return { ok: true, item };
}

export function getStatus() {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const adapters = loadAdapters();
  const adapterMap = Object.fromEntries(adapters.map((a) => [a.id, a]));

  const slots = Object.entries(cfg.slots).map(([id, slotCfg]) => {
    const mountedId = slotCfg.adapter || 'none';
    const mounted = mountedId === 'none' ? null : (adapterMap[mountedId] || null);
    return {
      id,
      ...slotCfg,
      adapter: mountedId,
      mounted,
    };
  });

  const briefingText = fs.existsSync(P.briefingPath)
    ? fs.readFileSync(P.briefingPath, 'utf8')
    : '';
  const inboxText = fs.existsSync(P.inboxPath)
    ? fs.readFileSync(P.inboxPath, 'utf8')
    : '';
  const results = loadResults();
  const tracks = loadTracks();
  const activeJobs = loadActiveJobs();

  return {
    hubRoot: P.hubRoot,
    workspaceRoot: path.resolve(P.hubRoot, cfg.workspaceRoot || '../..'),
    boardFile: cfg.boardFile || '',
    teamTitle: cfg.teamTitle || '班子配置',
    updatedAt: formatLocalTime(),
    antigravityApiAvailable: Boolean(process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN),
    handover: cfg.handover || {},
    slots,
    adapters,
    tracks,
    results,
    activeJobs,
    recent: {
      tasks: listRecentFiles(P.tasksDir, 8),
      deliveries: listRecentFiles(P.deliveriesDir, 8),
      reviews: listRecentFiles(P.reviewsDir, 8),
      handovers: listRecentFiles(P.handoversDir, 5),
    },
    briefingPreview: briefingText.slice(0, 1500),
    inboxPreview: inboxText.slice(0, 1500),
  };
}

export function setSlot(slotId, adapterId) {
  const cfg = loadConfig();
  if (!cfg.slots[slotId]) {
    throw new Error(`未知卡槽: ${slotId}（可用: ${Object.keys(cfg.slots).join(', ')}）`);
  }
  const slot = cfg.slots[slotId];
  if (adapterId === 'none' || adapterId === '' || adapterId === null) {
    slot.adapter = 'none';
    saveConfig(cfg);
    return { ok: true, slotId, adapter: 'none', message: `已拔出 ${slot.label}` };
  }
  const adapters = loadAdapters();
  const target = adapters.find((a) => a.id === adapterId);
  if (!target) {
    throw new Error(`未知模块: ${adapterId}（可用: ${adapters.map((a) => a.id).join(', ')}）`);
  }
  if (Array.isArray(slot.accepts) && slot.accepts.length > 0 && !slot.accepts.includes(target.kind)) {
    throw new Error(`模块 ${target.name}（类型 ${target.kind}）不兼容卡槽 ${slot.label}（允许: ${slot.accepts.join(', ')}）`);
  }
  slot.adapter = target.id;
  saveConfig(cfg);
  return {
    ok: true,
    slotId,
    adapter: target.id,
    status: target.status,
    message: `已将 ${target.name} 插入「${slot.label}」`,
  };
}

function slugify(text) {
  const clean = String(text || 'task')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return clean || 'task';
}

export function dispatchTask(opts) {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const slotId = opts.slot || 'worker';
  const slot = cfg.slots[slotId];
  if (!slot) throw new Error(`未知卡槽: ${slotId}`);

  const adapterId = opts.adapter || slot.adapter;
  if (!adapterId || adapterId === 'none') {
    throw new Error(`卡槽「${slot.label}」当前为空，请先插入一个可执行模块。`);
  }

  const adapters = loadAdapters();
  const adapter = adapters.find((a) => a.id === adapterId);
  if (!adapter) throw new Error(`未找到模块: ${adapterId}`);
  if (adapter.runner === 'passive-file-relay' || !adapter.runner) {
    throw new Error(`模块 ${adapter.name} 不是命令行执行器，无法直接 dispatch。`);
  }
  if (adapter.status !== 'ready') {
    throw new Error(`模块 ${adapter.name} 当前不可用（${adapter.status}: ${adapter.statusDetail}）`);
  }

  const title = opts.title || '批量处理任务';
  const mode = opts.mode === 'workspace-write' ? 'workspace-write' : 'read-only';
  const workspaceDir = opts.workspace
    ? path.resolve(opts.workspace)
    : path.resolve(P.hubRoot, cfg.workspaceRoot || '../..');
  const timeoutMs = (Number(opts.timeout) || 180) * 1000;

  let body = opts.prompt || '';
  if (opts.promptFile) {
    body = fs.readFileSync(path.resolve(opts.promptFile), 'utf8');
  }
  if (!body.trim()) {
    throw new Error('缺少任务内容（请提供 --prompt 或 --prompt-file）');
  }

  const taskId = `TASK-${formatStamp()}-${slugify(title)}`;
  const taskPath = path.join(P.tasksDir, `${taskId}.md`);
  const deliveryPath = path.join(P.deliveriesDir, `DELIVERY-${taskId}.md`);

  const taskMarkdown = [
    `# 任务单：${title}`,
    '',
    `- **Task ID**：\`${taskId}\``,
    `- **创建时间**：${formatLocalTime()}`,
    `- **派发卡槽**：${slot.label}（\`${slotId}\`）`,
    `- **执行模块**：${adapter.name}（\`${adapter.id}\`）`,
    `- **权限模式**：\`${mode}\``,
    `- **工作目录**：\`${workspaceDir}\``,
    '',
    '## 红线约束（必须遵守）',
    '1. 默认只执行本任务明确指定的范围，不擅自修改无关文件。',
    '2. 严禁打开、打印或修改 `*.sqlite3`、`.env`、密钥、Cookies；严禁执行生产库写操作或小程序提审。',
    '3. 除非任务明确要求，否则不要联网搜索，直接基于本地文件给出结构化结果。',
    '',
    '## 任务指令',
    body.trim(),
    '',
  ].join('\n');

  fs.writeFileSync(taskPath, taskMarkdown, 'utf8');

  const fullPrompt = [
    `你是多 AI 中枢的「${slot.label}」执行模块，请严格按下方任务单完成工作。`,
    `工作目录：${workspaceDir}`,
    `权限模式：${mode}（严禁触碰 .env / sqlite3 / 密钥 / 生产库写入）`,
    opts.noWeb ? '禁止联网搜索。' : '',
    '输出规范：第一段必须以【人话结论】开头，用 1-3 句大白话直接说清结果，不要专业术语、不要英文缩写、不要 Markdown 标题(#)或表格(|)；所有专业细节、核对过程和表格请统一放到后面的【详细记录（给AI看）】里。',
    '',
    '--- 任务内容 ---',
    body.trim(),
  ].filter(Boolean).join('\n');

  // Prepare isolated child env (load adapter envFiles silently without ever logging values)
  const childEnv = { ...process.env };
  if (adapter.detect?.envFiles?.length) {
    Object.assign(childEnv, loadEnvFilesSilently(adapter.detect.envFiles));
  }

  const start = Date.now();
  let runRes;
  let capturedOutput = '';
  let stderrText = '';

  if (adapter.runner === 'deepseek-dsh') {
    const args = ['--profile', 'headless', '--approval-policy', 'never'];
    if (mode === 'read-only') {
      args.push('--permission-mode', 'read-only');
    } else if (mode === 'workspace-write') {
      args.push('--permission-mode', 'workspace-write', '--add-dir', workspaceDir);
    }
    if (opts.sessionId) {
      args.push('--session-id', opts.sessionId);
    }
    args.push(fullPrompt);
    runRes = spawnSync(adapter.resolvedBinary, args, {
      cwd: workspaceDir,
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    capturedOutput = (runRes.stdout || '').trim();
    stderrText = (runRes.stderr || '').trim();
  } else if (adapter.runner === 'codex-cli') {
    const tmpOut = path.join(os.tmpdir(), `ai-hub-codex-${taskId}.txt`);
    const args = [
      'exec',
      '-C', workspaceDir,
      '-s', mode === 'workspace-write' ? 'workspace-write' : 'read-only',
      '--skip-git-repo-check',
      '-o', tmpOut,
      fullPrompt,
    ];
    runRes = spawnSync(adapter.resolvedBinary, args, {
      cwd: workspaceDir,
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (fs.existsSync(tmpOut)) {
      capturedOutput = fs.readFileSync(tmpOut, 'utf8').trim();
      fs.unlinkSync(tmpOut);
    } else {
      capturedOutput = (runRes.stdout || '').trim();
    }
    stderrText = (runRes.stderr || '').trim();
  } else if (adapter.runner === 'claude-cli') {
    const args = ['-p', fullPrompt];
    runRes = spawnSync(adapter.resolvedBinary, args, {
      cwd: workspaceDir,
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    capturedOutput = (runRes.stdout || '').trim();
    stderrText = (runRes.stderr || '').trim();
  } else if (adapter.runner === 'gemini-cli') {
    const args = ['-p', fullPrompt];
    runRes = spawnSync(adapter.resolvedBinary, args, {
      cwd: workspaceDir,
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    capturedOutput = (runRes.stdout || '').trim();
    stderrText = (runRes.stderr || '').trim();
  } else if (adapter.runner === 'custom-command' && Array.isArray(adapter.commandTemplate)) {
    const [cmd, ...tplArgs] = adapter.commandTemplate;
    const args = tplArgs.map((a) =>
      String(a)
        .replaceAll('{{PROMPT}}', fullPrompt)
        .replaceAll('{{WORKSPACE}}', workspaceDir)
        .replaceAll('{{TASK_FILE}}', taskPath)
    );
    runRes = spawnSync(resolveBinary([cmd]) || cmd, args, {
      cwd: workspaceDir,
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    capturedOutput = (runRes.stdout || '').trim();
    stderrText = (runRes.stderr || '').trim();
  } else {
    throw new Error(`不支持的执行器类型: ${adapter.runner}`);
  }

  const durationMs = Date.now() - start;
  const timedOut = Boolean(runRes.error && runRes.error.code === 'ETIMEDOUT');
  const exitCode = timedOut ? 124 : (runRes.status ?? 1);
  const ok = exitCode === 0 && !timedOut;

  const deliveryMarkdown = [
    `# 交付件：${title}`,
    '',
    `- **Task ID**：\`${taskId}\``,
    `- **完成时间**：${formatLocalTime()}`,
    `- **执行模块**：${adapter.name}（\`${adapter.id}\`）`,
    `- **状态**：${ok ? '✅ 成功' : (timedOut ? '⏱️ 超时' : `❌ 失败 (exit ${exitCode})`)}`,
    `- **耗时**：${(durationMs / 1000).toFixed(1)}s`,
    `- **任务单**：\`${path.relative(P.runtimeDir, taskPath)}\``,
    '',
    '## 执行产出',
    capturedOutput || '（无标准输出）',
    '',
    ...(stderrText && !ok ? ['## 诊断信息 (stderr)', '```text', stderrText.slice(0, 2000), '```', ''] : []),
  ].join('\n');

  fs.writeFileSync(deliveryPath, deliveryMarkdown, 'utf8');

function extractConclusion(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  let section = raw;
  const cutIdx = section.search(/(?:^|\n|\s)(?:#{2,3}\s*(?:一、|二、|三、|通路|过程|详细|说明|核对|技术)|【(?:过程|详细记录[^】]*|技术细节)】|(?:过程|详细记录)[：:])/);
  if (cutIdx > 0) {
    section = section.slice(0, cutIdx);
  }
  const conclMatch = section.match(/(?:【(?:人话结论|一句话结论|结论)】|\*\*(?:人话结论|先给结论|结论)\*\*[：:]?|(?:人话结论|先给结论|结论)[：:])\s*([\s\S]+)/);
  if (conclMatch) {
    section = conclMatch[1];
  }
  const tableIdx = section.search(/\s\|[^|]+\|\s*\|[-:\s|]+\|/);
  if (tableIdx > 0) {
    section = section.slice(0, tableIdx);
  }
  const lines = section
    .split(/\r?\n/)
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l) && !/^\s*#+\s/.test(l) && !/^\s*---+\s*$/.test(l) && !/^\s*```/.test(l))
    .map((l) =>
      l
        .replace(/^#+\s*/, '')
        .replace(/^\s*[-*•]\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^(?:先给结论|人话结论|一句话结论|结论)[：:\s-]*/, '')
        .trim()
    )
    .filter(Boolean);
  const joined = lines.slice(0, 3).join('\n');
  return joined.length > 180 ? joined.slice(0, 179) + '…' : joined;
}

  if (ok) {
    recordResult({
      title,
      summary: extractConclusion(capturedOutput) || cleanMd(capturedOutput).slice(0, 140),
      files: [deliveryPath],
      by: `${slot.label} · ${adapter.name}`,
      runtimeRelPath: path.relative(P.runtimeDir, deliveryPath),
      trackId: opts.trackId || null,
    });
  }

  if (opts.jobId) {
    const remaining = loadActiveJobs().filter((j) => j.jobId !== opts.jobId);
    saveActiveJobs(remaining);
  }
  if (opts.promptFile && opts.promptFile.startsWith(os.tmpdir())) {
    try { fs.unlinkSync(opts.promptFile); } catch {}
  }

  return {
    ok,
    taskId,
    slot: slotId,
    adapter: adapter.id,
    adapterName: adapter.name,
    exitCode,
    timedOut,
    durationMs,
    taskPath,
    deliveryPath,
    deliveryRelPath: path.relative(P.runtimeDir, deliveryPath),
    preview: capturedOutput.slice(0, 320),
    errorSummary: ok ? null : (stderrText.slice(0, 400) || (runRes.error?.message ?? '执行失败')),
  };
}

export function recordReview({ taskId, verdict = 'PASS', summary = '', notes = '' }) {
  const P = ensureInitialized();
  const safeId = slugify(taskId || `manual-${formatStamp()}`);
  const reviewPath = path.join(P.reviewsDir, `REVIEW-${safeId}.md`);
  const md = [
    `# 审核单：${taskId || safeId}`,
    '',
    `- **审核时间**：${formatLocalTime()}`,
    `- **结论**：${verdict}`,
    '',
    '## 精炼摘要（回传主对话）',
    summary || '（未填摘要）',
    '',
    ...(notes ? ['## 详细意见', notes, ''] : []),
  ].join('\n');
  fs.writeFileSync(reviewPath, md, 'utf8');
  return { ok: true, reviewPath, relPath: path.relative(P.runtimeDir, reviewPath) };
}

export function updateBriefing(markdown) {
  const P = ensureInitialized();
  const content = markdown.includes('更新时间')
    ? markdown
    : `# 多 AI 中枢 · 最新进度简报\n\n- **更新时间**：${formatLocalTime()}\n\n${markdown.trim()}\n`;
  fs.writeFileSync(P.briefingPath, content, 'utf8');
  return { ok: true, path: P.briefingPath, updatedAt: formatLocalTime() };
}

export function addInboxItem(text, source = 'mobile') {
  const P = ensureInitialized();
  const cur = fs.readFileSync(P.inboxPath, 'utf8').replace('- （暂无待处理远程指令）\n', '');
  const line = `- [ ] [${formatLocalTime()} · ${source}] ${text.trim()}\n`;
  fs.writeFileSync(P.inboxPath, cur.trimEnd() + '\n' + line, 'utf8');
  return { ok: true, path: P.inboxPath, added: line.trim() };
}

export function replyBridgeRequest({ requestId, reply, ok = true, error = null }) {
  const P = ensureInitialized();
  const id = String(requestId || '').trim();
  if (!id) throw new Error('缺少 requestId');
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) throw new Error('无效的 requestId');
  const outDir = path.join(P.runtimeDir, process.env.HUB_BRIDGE_DIR || 'mobile-bridge', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${safeId}.json`);
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    id: safeId,
    ok: Boolean(ok),
    reply: String(reply || '').trim(),
    ...(error ? { error: String(error) } : {}),
    repliedAt: formatLocalTime(),
  };
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, outPath);
  return { ok: true, requestId: safeId, outPath };
}

export function readRuntimeFile(relPath) {
  const P = ensureInitialized();
  const full = path.resolve(P.runtimeDir, relPath);
  if (!full.startsWith(P.runtimeDir + path.sep) && full !== P.runtimeDir) {
    throw new Error('越权路径：只允许读取 runtime/ 目录内文件');
  }
  if (!fs.existsSync(full)) {
    throw new Error(`文件不存在: ${relPath}`);
  }
  return {
    relPath,
    fullPath: full,
    content: fs.readFileSync(full, 'utf8'),
  };
}

export async function handoverConversation(opts) {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const title = opts.title || `续接对话-${formatStamp()}`;
  const summary = opts.summary || '承接上一条对话的已落盘进度。';
  const files = Array.isArray(opts.files)
    ? opts.files
    : String(opts.files || '').split(',').map((s) => s.trim()).filter(Boolean);
  const nextSteps = opts.nextSteps || '确认当前状态并继续推进下一步。';
  const model = opts.model || cfg.handover?.defaultModel || 'pro';
  const archiveCurrent = opts.archiveCurrent ?? (cfg.handover?.autoArchiveOld ?? true);

  const stamp = formatStamp();
  const handoverPath = path.join(P.handoversDir, `HANDOVER-${stamp}-${slugify(title)}.md`);
  const handoverRel = path.relative(P.hubRoot, handoverPath);

  const handoverDoc = [
    `# 对话接力单：${title}`,
    '',
    `- **交接时间**：${formatLocalTime()}`,
    `- **旧对话 ID**：\`${process.env.ANTIGRAVITY_CONVERSATION_ID || 'N/A'}\``,
    '',
    '## 一、阶段总结',
    summary,
    '',
    '## 二、先读文件',
    ...(files.length ? files.map((f) => `- \`${f}\``) : ['- `事情总表.md`', '- `协作与工具/多AI中枢/runtime/进度简报.md`']),
    '',
    '## 三、下一步动作',
    nextSteps,
    '',
  ].join('\n');

  fs.writeFileSync(handoverPath, handoverDoc, 'utf8');

  const initialPrompt = [
    `【自动接力新对话】承接上一条对话进度，请先读取交接单 \`${handoverPath}\`${files.length ? ` 以及：${files.join('、')}` : ''}。`,
    '',
    `- **当前阶段总结**：${summary}`,
    `- **下一步目标**：${nextSteps}`,
    '',
    '请确认已接棒，用 3 句话汇报你读到的上下文和准备立即执行的下一步，等待用户确认或继续指令。',
  ].join('\n');

  const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  const projectId = process.env.ANTIGRAVITY_PROJECT_ID;
  const currentConvId = process.env.ANTIGRAVITY_CONVERSATION_ID;

  if (!opts.dryRun && lsAddr && csrf) {
    const headers = {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'x-antigravity-csrf-token': csrf,
    };
    const createBody = {
      title,
      model,
      tags: ['ai-hub-handover'],
      prompt: [{ text: initialPrompt }],
      ...(projectId ? { projectId } : {}),
    };
    const res = await fetch(`http://${lsAddr}/product.v1.ConversationService/CreateConversation`, {
      method: 'POST',
      headers,
      body: JSON.stringify(createBody),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        mode: 'antigravity-error',
        error: `CreateConversation HTTP ${res.status}: ${errText.slice(0, 300)}`,
        handoverPath,
        copyPrompt: initialPrompt,
      };
    }
    const created = await res.json();
    const newId = created?.conversation?.id;
    let archivedOld = false;
    if (opts.trackId && newId) {
      const bindRes = await bindTrackConversation({
        trackId: opts.trackId,
        conversationId: newId,
        archivePrevious: Boolean(archiveCurrent),
      });
      if (bindRes.archivedPreviousId) archivedOld = true;
    }
    if (!archivedOld && archiveCurrent && currentConvId && currentConvId !== newId) {
      archivedOld = await archiveConversationById(currentConvId);
    }
    return {
      ok: true,
      mode: 'antigravity-auto',
      newConversationId: newId,
      link: newId ? `[👉 点此进入已接棒的新对话：${title}](conversation://${newId})` : null,
      archivedOld,
      handoverPath,
      handoverRel,
      copyPrompt: initialPrompt,
    };
  }

  return {
    ok: true,
    mode: opts.dryRun ? 'dry-run' : 'copy-prompt',
    handoverPath,
    handoverRel,
    copyPrompt: initialPrompt,
  };
}

// --- CLI Entrypoint ---
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0] || 'status';

  if (cmd === 'status') {
    const st = getStatus();
    if (flags.json) {
      console.log(JSON.stringify(st, null, 2));
      return;
    }
    console.log(`=== 多 AI 模块化中枢 (${st.hubRoot}) ===`);
    for (const s of st.slots) {
      const m = s.mounted;
      const badge = !m ? '⚪ 空槽' : (m.status === 'ready' ? '🟢 就绪' : (m.status === 'missing_key' ? '🟡 缺凭据' : '⚫ 未安装'));
      console.log(`- [${s.id}] ${s.label}: ${m ? `${m.icon} ${m.name} (${m.id})` : '未插模块'}  ${badge}${m ? ` · ${m.statusDetail}` : ''}`);
    }
    console.log(`Antigravity 无感换新接口: ${st.antigravityApiAvailable ? '🟢 可用' : '⚪ 非 Antigravity 环境（降级为交接词）'}`);
    return;
  }

  if (cmd === 'adapters') {
    const list = loadAdapters();
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  if (cmd === 'slot' && pos[1] === 'set') {
    const slotId = pos[2];
    const adapterId = pos[3];
    if (!slotId || !adapterId) {
      throw new Error('用法: hub-ctl.mjs slot set <slotId> <adapterId|none>');
    }
    console.log(JSON.stringify(setSlot(slotId, adapterId), null, 2));
    return;
  }

  if (cmd === 'dispatch') {
    const res = dispatchTask({
      title: flags.title,
      prompt: flags.prompt,
      promptFile: flags['prompt-file'],
      slot: flags.slot || 'worker',
      adapter: flags.adapter,
      mode: flags.mode || 'read-only',
      workspace: flags.workspace,
      sessionId: flags['session-id'],
      timeout: flags.timeout,
      noWeb: Boolean(flags['no-web']),
      trackId: flags['track-id'] || null,
      jobId: flags['job-id'] || null,
    });
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'review') {
    const res = recordReview({
      taskId: flags['task-id'] || pos[1],
      verdict: flags.verdict || 'PASS',
      summary: flags.summary || '',
      notes: flags.notes || '',
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'brief') {
    const sub = pos[1] || 'show';
    if (sub === 'show') {
      const P = ensureInitialized();
      console.log(fs.readFileSync(P.briefingPath, 'utf8'));
      return;
    }
    if (sub === 'update') {
      const content = flags.file ? fs.readFileSync(path.resolve(flags.file), 'utf8') : (flags.content || pos.slice(2).join(' '));
      if (!content) throw new Error('用法: hub-ctl.mjs brief update --content "..." 或 --file path');
      console.log(JSON.stringify(updateBriefing(content), null, 2));
      return;
    }
  }

  if (cmd === 'inbox') {
    const sub = pos[1] || 'list';
    if (sub === 'list') {
      const P = ensureInitialized();
      console.log(fs.readFileSync(P.inboxPath, 'utf8'));
      return;
    }
    if (sub === 'add') {
      const text = flags.text || pos.slice(2).join(' ');
      if (!text) throw new Error('用法: hub-ctl.mjs inbox add "指令内容"');
      console.log(JSON.stringify(addInboxItem(text, flags.source || 'mobile'), null, 2));
      return;
    }
  }

  if (cmd === 'result') {
    const res = recordResult({
      title: flags.title || pos[1] || '成品结果',
      summary: flags.summary || '',
      files: flags.files || '',
      by: flags.by || '主力',
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'handover') {
    const res = await handoverConversation({
      title: flags.title,
      summary: flags.summary,
      files: flags.files,
      nextSteps: flags.next,
      model: flags.model,
      archiveCurrent: flags['no-archive'] ? false : true,
      dryRun: Boolean(flags['dry-run']),
    });
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exitCode = 1;
    return;
  }

  console.error(`未知命令: ${cmd}`);
  console.error('可用命令: status | adapters | slot set <slot> <adapter|none> | dispatch | review | brief | inbox | handover');
  process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  });
}
