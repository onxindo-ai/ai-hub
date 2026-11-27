#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getHubPaths,
  ensureInitialized,
  getStatus,
  setSlot,
  dispatchTaskAsync,
  addCustomTrack,
  updateTrackMeta,
  deleteTrack,
  readRuntimeFile,
  loadActiveJobs,
  loadConfig,
  recordResult,
  formatLocalTime,
  formatStamp,
} from '../bin/hub-ctl.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HANDOVER_TURN_THRESHOLD = 12;
const HANDOVER_TOKEN_THRESHOLD = 80000;

if (process.argv.includes('--parent-watch')) {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}

function getSessionsPath() {
  const P = ensureInitialized();
  return path.join(P.runtimeDir, '桌面会话.json');
}

function loadDesktopSessions() {
  const fp = getSessionsPath();
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveDesktopSessions(map) {
  const fp = getSessionsPath();
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, fp);
}

function resolveAgyBinary() {
  const candidates = [
    process.env.AGY_BIN,
    path.join(os.homedir(), '.local', 'bin', 'agy'),
    path.join(os.homedir(), '.antigravity', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // continue
    }
  }
  const res = spawnSync('which', ['agy'], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout.trim()) {
    return res.stdout.trim().split('\n')[0];
  }
  return null;
}

function buildExtraPath(agyBin) {
  return [
    agyBin ? path.dirname(agyBin) : '',
    path.dirname(process.execPath),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.antigravity', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH || '',
  ].filter(Boolean).join(':');
}

function saveActiveJobsFile(list) {
  const P = ensureInitialized();
  const tmp = `${P.activeJobsPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, P.activeJobsPath);
}

function removeActiveJob(jobId) {
  try {
    const cur = loadActiveJobs().filter((j) => j.jobId !== jobId);
    saveActiveJobsFile(cur);
  } catch {
    // ignore
  }
}

function parseAgyJson(rawStdout) {
  const lines = String(rawStdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('{') && lines[i].endsWith('}')) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // continue
      }
    }
  }
  return null;
}

function buildFirstTurnDesktopPrompt({ userPrompt, trackTitle, mainLabel, handoverSummary }) {
  return [
    `你是用户的主力搭档「${mainLabel}」，当前在桌面「多AI中枢」面板里与用户连续对话。`,
    '要求：',
    '1. 简单问答、测试或随手交代直接用大白话秒回（2-6行），不要无故扫描文件或通读总表；',
    '2. 只有明确涉及具体业务数据、对账、行情或改文件时，才按需只读最核心的 1-2 个文件，严守 AGENTS.md 红线；',
    '3. 严禁调用任何 MCP 工具（如 ai-hub_hub / hub_handover_conversation），桌面无头通道不允许 MCP 权限弹窗；',
    '4. 如果你判断当前上下文已经太长需要换新，或苏让你测试/弹出「切换新对话按钮」，直接在你回复的最后另起一行输出【建议换新】，面板收到后会自动弹出可点击的「一键交接换新」按钮。',
    ...(trackTitle ? [`5. 当前关联主线：「${trackTitle}」。`] : []),
    ...(handoverSummary ? ['', '--- 承接上一条对话的交接总结 ---', handoverSummary, '--- 以上为交接背景 ---'] : []),
    '',
    `苏说：${userPrompt}`,
  ].join('\n');
}

function runAgyTurn({ agyBin, workspaceRoot, extraPath, conversationId, promptText, effort = 'low' }) {
  return new Promise((resolve) => {
    const args = [
      '--effort', effort,
      '--output-format', 'json',
      '--print-timeout', '180s',
      `--print=${promptText}`,
    ];
    if (conversationId) {
      args.unshift('--conversation', conversationId);
    }

    const child = spawn(agyBin, args, {
      cwd: workspaceRoot,
      env: { ...process.env, PATH: extraPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      const parsed = parseAgyJson(stdout);
      const reply = String(parsed?.response || '').trim();
      const convId = parsed?.conversation_id || conversationId || null;
      const inputTokens = Number(parsed?.usage?.input_tokens || 0);
      const totalTokens = Number(parsed?.usage?.total_tokens || 0);
      const ok = code === 0 && Boolean(reply);
      resolve({
        ok,
        code,
        reply,
        convId,
        inputTokens,
        totalTokens,
        durationSec: parsed?.duration_seconds || null,
        stdout,
        stderr,
      });
    });
  });
}

function dispatchMainAsync({ prompt, trackId = null, trackTitle = '', resetSession = false, effort = 'low' }) {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const st = getStatus();
  const mainLabel = st.slots.find((s) => s.id === 'orchestrator')?.label || '主力';
  const agyBin = resolveAgyBinary();
  if (!agyBin) {
    throw new Error('未找到官方 agy CLI，请先确认 ~/.local/bin/agy 可用');
  }

  const workspaceRoot = path.resolve(P.hubRoot, cfg.workspaceRoot || '../..');
  const channelKey = trackId || 'general';
  const sessions = loadDesktopSessions();
  if (resetSession && sessions[channelKey]) {
    delete sessions[channelKey];
    saveDesktopSessions(sessions);
  }
  const existing = sessions[channelKey] || null;
  const existingConvId = existing?.conversationId || null;
  const pendingSummary = !existingConvId ? (existing?.pendingHandoverSummary || '') : '';

  const jobId = `JOB-${formatStamp()}-${Math.random().toString(36).slice(2, 6)}`;
  const shortTitle = trackTitle
    ? `${trackTitle.slice(0, 12)} · ${prompt.slice(0, 12)}`
    : prompt.slice(0, 18);

  const jobs = loadActiveJobs();
  const job = {
    jobId,
    title: shortTitle,
    slot: 'orchestrator',
    slotLabel: mainLabel,
    adapter: 'agy-cli',
    adapterName: mainLabel,
    trackId: trackId || null,
    reusedSession: Boolean(existingConvId),
    startedAt: formatLocalTime(),
    startedAtMs: Date.now(),
    status: 'running',
  };
  jobs.unshift(job);
  saveActiveJobsFile(jobs);

  const extraPath = buildExtraPath(agyBin);
  const safeEffort = ['low', 'medium', 'high'].includes(effort) ? effort : 'low';

  (async () => {
    const started = Date.now();
    try {
      let promptText;
      if (existingConvId) {
        // For sessions created before v2 rules, attach a 1-line guard so it never hits blocked MCP tools
        promptText = existing?.v2
          ? prompt
          : `[桌面快回提醒：禁止调用任何 MCP 工具；如需弹出换新按钮请在回复末尾写【建议换新】]\n${prompt}`;
      } else {
        promptText = buildFirstTurnDesktopPrompt({
          userPrompt: prompt,
          trackTitle,
          mainLabel,
          handoverSummary: pendingSummary,
        });
      }

      let res = await runAgyTurn({
        agyBin,
        workspaceRoot,
        extraPath,
        conversationId: existingConvId,
        promptText,
        effort: safeEffort,
      });

      let fellBackFresh = false;
      if (!res.ok && existingConvId) {
        fellBackFresh = true;
        res = await runAgyTurn({
          agyBin,
          workspaceRoot,
          extraPath,
          conversationId: null,
          promptText: buildFirstTurnDesktopPrompt({
            userPrompt: prompt,
            trackTitle,
            mainLabel,
            handoverSummary: pendingSummary,
          }),
          effort: safeEffort,
        });
      }

      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const chatDir = path.join(P.runtimeDir, '桌面对话');
      fs.mkdirSync(chatDir, { recursive: true });
      const logFile = path.join(chatDir, `CHAT-${formatStamp()}.md`);
      const logRel = path.relative(P.runtimeDir, logFile);

      const aiRequestedHandover = /【建议换新】/.test(res.reply || '');
      const cleanReply = String(res.reply || '').replace(/\s*【建议换新】\s*/g, '').trim();

      const logMd = [
        `# 桌面中枢对话记录`,
        '',
        `- **时间**：${formatLocalTime()}`,
        `- **通道**：${channelKey}${trackTitle ? `（${trackTitle}）` : ''}`,
        `- **对话 ID**：\`${res.convId || 'N/A'}\`${existingConvId && !fellBackFresh ? '（续聊同对话）' : '（新开对话）'}`,
        `- **输入 Token**：${res.inputTokens || 0}`,
        `- **耗时**：${elapsed}s`,
        '',
        '## 苏说',
        prompt,
        '',
        '## 执行产出',
        res.ok ? cleanReply : `⚠️ 暂未收到回复：${(res.stderr || `退出码 ${res.code}`).slice(0, 300)}`,
        '',
      ].join('\n');
      fs.writeFileSync(logFile, logMd, 'utf8');

      if (res.ok) {
        const curSessions = loadDesktopSessions();
        const prevTurns = (!fellBackFresh && curSessions[channelKey]?.conversationId === res.convId)
          ? (curSessions[channelKey]?.turns || 0)
          : 0;
        const nextTurns = prevTurns + 1;
        const suggestHandover = aiRequestedHandover
          || nextTurns >= HANDOVER_TURN_THRESHOLD
          || (res.inputTokens >= HANDOVER_TOKEN_THRESHOLD);

        if (res.convId) {
          curSessions[channelKey] = {
            conversationId: res.convId,
            turns: nextTurns,
            inputTokens: res.inputTokens || 0,
            suggestHandover,
            suggestReason: aiRequestedHandover
              ? '主力已触发换新提醒'
              : (res.inputTokens >= HANDOVER_TOKEN_THRESHOLD ? '上下文长度接近阈值' : (nextTurns >= HANDOVER_TURN_THRESHOLD ? '连续对话轮数较多' : '')),
            v2: true,
            trackTitle: trackTitle || '',
            updatedAt: formatLocalTime(),
          };
          saveDesktopSessions(curSessions);
        }
        recordResult({
          title: prompt.slice(0, 22),
          summary: cleanReply || '已收到，建议点上方按钮一键交接切换新对话。',
          files: [logFile],
          by: `${mainLabel}${nextTurns > 1 ? ` · 续聊第${nextTurns}轮` : ''}`,
          runtimeRelPath: logRel,
          trackId: trackId || null,
        });
      } else {
        recordResult({
          title: `未送达：${prompt.slice(0, 16)}`,
          summary: `回复失败：${(res.stderr || `退出码 ${res.code}`).slice(0, 180)}`,
          files: [logFile],
          by: mainLabel,
          runtimeRelPath: logRel,
          trackId: trackId || null,
        });
      }
    } finally {
      removeActiveJob(jobId);
    }
  })();

  return { ok: true, job };
}

function handoverDesktopSessionAsync({ trackId = null, trackTitle = '' }) {
  const P = ensureInitialized();
  const cfg = loadConfig();
  const st = getStatus();
  const mainLabel = st.slots.find((s) => s.id === 'orchestrator')?.label || '主力';
  const channelKey = trackId || 'general';
  const sessions = loadDesktopSessions();
  const existing = sessions[channelKey];

  // If no existing conversation, simply reset cleanly right away
  if (!existing || !existing.conversationId) {
    delete sessions[channelKey];
    saveDesktopSessions(sessions);
    return { ok: true, immediate: true, message: '已准备好全新对话' };
  }

  const agyBin = resolveAgyBinary();
  if (!agyBin) {
    delete sessions[channelKey];
    saveDesktopSessions(sessions);
    return { ok: true, immediate: true, message: '已重置为新对话' };
  }

  const workspaceRoot = path.resolve(P.hubRoot, cfg.workspaceRoot || '../..');
  const jobId = `JOB-${formatStamp()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobs = loadActiveJobs();
  const job = {
    jobId,
    title: '正在总结交接并切到全新对话',
    slot: 'orchestrator',
    slotLabel: mainLabel,
    adapter: 'agy-cli',
    adapterName: mainLabel,
    trackId: trackId || null,
    startedAt: formatLocalTime(),
    startedAtMs: Date.now(),
    status: 'running',
  };
  jobs.unshift(job);
  saveActiveJobsFile(jobs);

  const extraPath = buildExtraPath(agyBin);
  const oldConvId = existing.conversationId;

  (async () => {
    try {
      const summaryPrompt = '请用 3 句简洁中文大白话总结我们刚才这条对话的核心结论、已确认事项和下一步（纯文本直接回复，严禁调用任何工具）。';
      const res = await runAgyTurn({
        agyBin,
        workspaceRoot,
        extraPath,
        conversationId: oldConvId,
        promptText: summaryPrompt,
        effort: 'low',
      });

      const summaryText = res.ok
        ? res.reply.replace(/\s*【建议换新】\s*/g, '').trim()
        : '承接上一条桌面中枢对话的已落盘进度。';

      const handoverFile = path.join(P.handoversDir, `HANDOVER-${formatStamp()}-桌面续接.md`);
      const handoverRel = path.relative(P.runtimeDir, handoverFile);
      const doc = [
        `# 桌面中枢自动交接单`,
        '',
        `- **交接时间**：${formatLocalTime()}`,
        `- **通道**：${channelKey}${trackTitle ? `（${trackTitle}）` : ''}`,
        `- **旧对话 ID**：\`${oldConvId}\``,
        '',
        '## 执行产出',
        summaryText,
        '',
      ].join('\n');
      fs.writeFileSync(handoverFile, doc, 'utf8');

      const curSessions = loadDesktopSessions();
      curSessions[channelKey] = {
        conversationId: null,
        turns: 0,
        inputTokens: 0,
        suggestHandover: false,
        suggestReason: '',
        pendingHandoverSummary: summaryText,
        handoverFile: handoverRel,
        v2: true,
        trackTitle: trackTitle || '',
        updatedAt: formatLocalTime(),
      };
      saveDesktopSessions(curSessions);

      recordResult({
        title: `🔄 已交接并切到新对话${trackTitle ? `（${trackTitle}）` : ''}`,
        summary: summaryText,
        files: [handoverFile],
        by: `${mainLabel} · 交接单`,
        runtimeRelPath: handoverRel,
        trackId: trackId || null,
      });
    } finally {
      removeActiveJob(jobId);
    }
  })();

  return { ok: true, async: true, job };
}

function getFullStatus() {
  const st = getStatus();
  return {
    ...st,
    desktopSessions: loadDesktopSessions(),
    handoverThresholds: {
      turns: HANDOVER_TURN_THRESHOLD,
      tokens: HANDOVER_TOKEN_THRESHOLD,
    },
  };
}

function activateExistingAntigravityFallback() {
  const script = 'tell application "System Events" to set frontmost of (first process whose bundle identifier is "com.google.antigravity") to true';
  spawn('/usr/bin/osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
  return { ok: true };
}

function revealInFinder(targetPath) {
  const P = getHubPaths();
  const st = getStatus();
  const raw = String(targetPath || '').trim();
  if (!raw) throw new Error('缺少文件路径');
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(st.workspaceRoot, raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`文件不存在：${raw}`);
  }
  if (!resolved.startsWith(st.workspaceRoot) && !resolved.startsWith(P.hubRoot)) {
    throw new Error('仅允许定位工作区内文件');
  }
  spawn('/usr/bin/open', ['-R', resolved], { stdio: 'ignore', detached: true }).unref();
  return { ok: true, path: resolved };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 512 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const PLAIN_WORKER_RULES = [
  '严格输出要求：',
  '1. 第一段必须以【人话结论】开头，只用大白话写 1-3 句结果，像给老板发微信汇报一样通俗易懂，严禁出现专业术语、英文代码词、Markdown 标题(#)、加粗(**)或表格(|)；',
  '2. 所有专业术语、核对过程、文件路径和表格，统一另起一段写【详细记录（给AI看）】放到后面（面板默认隐藏，仅供主力 AI 查阅）；',
  '3. 直接基于上下文作答，不要扫描无关目录。',
].join('\n');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/') {
      const htmlPath = path.join(__dirname, 'panel-mac.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, { ok: true, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/slot') {
      const body = await readJsonBody(req);
      const action = setSlot(body.slotId, body.adapterId);
      sendJson(res, 200, { ok: true, action, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/track/add') {
      const body = await readJsonBody(req);
      const result = addCustomTrack(body);
      sendJson(res, 200, { ok: true, result, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/track/update') {
      const body = await readJsonBody(req);
      const result = updateTrackMeta(body);
      sendJson(res, 200, { ok: true, result, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/track/delete') {
      const body = await readJsonBody(req);
      const result = deleteTrack(body.trackId);
      sendJson(res, 200, { ok: true, result, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat/reset') {
      const body = await readJsonBody(req);
      const key = body.trackId || 'general';
      const sessions = loadDesktopSessions();
      delete sessions[key];
      saveDesktopSessions(sessions);
      sendJson(res, 200, { ok: true, channelKey: key, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat/handover') {
      const body = await readJsonBody(req);
      const result = handoverDesktopSessionAsync({
        trackId: body.trackId || null,
        trackTitle: body.trackTitle || '',
      });
      sendJson(res, 200, { ok: true, result, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat/dismiss-handover') {
      const body = await readJsonBody(req);
      const key = body.trackId || 'general';
      const sessions = loadDesktopSessions();
      if (sessions[key]) {
        sessions[key].suggestHandover = false;
        saveDesktopSessions(sessions);
      }
      sendJson(res, 200, { ok: true, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/result/delete') {
      const body = await readJsonBody(req);
      const targetId = String(body.id || '').trim();
      const P = ensureInitialized();
      if (targetId && fs.existsSync(P.resultsPath)) {
        const list = JSON.parse(fs.readFileSync(P.resultsPath, 'utf8'));
        if (Array.isArray(list)) {
          const next = list.filter((r) => r.id !== targetId);
          fs.writeFileSync(P.resultsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
        }
      }
      sendJson(res, 200, { ok: true, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dispatch-worker') {
      const body = await readJsonBody(req);
      const rawPrompt = String(body.prompt || '').trim();
      if (!rawPrompt) throw new Error('请输入任务内容');
      const contextLines = body.context ? `${String(body.context).trim()}\n\n` : '';
      const result = dispatchTaskAsync({
        title: body.title || rawPrompt.slice(0, 18),
        prompt: `${contextLines}用户要求：${rawPrompt}\n\n${PLAIN_WORKER_RULES}`,
        slot: 'worker',
        mode: 'read-only',
        noWeb: true,
        timeout: 180,
        trackId: body.trackId || null,
      });
      sendJson(res, 200, { ok: true, result, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ask-main') {
      const body = await readJsonBody(req);
      const rawPrompt = String(body.prompt || '').trim();
      if (!rawPrompt) throw new Error('请输入要交代给主力的事');
      const result = dispatchMainAsync({
        prompt: rawPrompt,
        trackId: body.trackId || null,
        trackTitle: body.trackTitle || '',
        resetSession: Boolean(body.resetSession),
        effort: body.effort || 'low',
      });
      sendJson(res, 200, { ok: true, result, status: getFullStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/runtime-file') {
      const body = await readJsonBody(req);
      const file = readRuntimeFile(body.relPath);
      sendJson(res, 200, { ok: true, file });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/activate-ide') {
      const result = activateExistingAntigravityFallback();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reveal-file') {
      const body = await readJsonBody(req);
      const result = revealInFinder(body.path);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || '请求处理失败' });
  }
});

const requestedPort = Number(process.env.AI_HUB_MAC_PORT || 0);
server.listen(requestedPort, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : requestedPort;
  process.stdout.write(`PORT=${port}\n`);
});
