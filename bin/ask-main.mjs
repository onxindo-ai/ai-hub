#!/usr/bin/env node
/**
 * 手机秘书（或任意外部机器人）→ Antigravity 主力（官方 agy CLI）一键直连脚本
 *
 * 完整链路：
 *   用户手机发「转主力：...」 → 手机秘书调用本脚本 → 官方 agy CLI 在工作区唤醒 Antigravity 主力
 *   → 主力按正常工作链路处理（读总表、动脑、必要时派黑奴 DeepSeek 干体力活并验收）
 *   → 主力把大白话结论直接吐回本脚本 stdout → 手机秘书原样回给用户手机
 *
 * 用法：
 *   node ask-main.mjs "<用户的原始任务内容>" [--timeout 240] [--source 手机秘书] [--no-record]
 *   node ask-main.mjs health
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  formatLocalTime,
  formatStamp,
  getHubPaths,
  loadConfig,
  loadTracks,
  recordResult,
} from './hub-ctl.mjs';

function resolveAgyBinary() {
  const candidates = [
    process.env.AGY_BIN,
    path.join(os.homedir(), '.local', 'bin', 'agy'),
    path.join(os.homedir(), '.antigravity', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // continue
    }
  }
  const whichRes = spawnSync('which', ['agy'], { encoding: 'utf8' });
  if (whichRes.status === 0 && whichRes.stdout.trim()) {
    return whichRes.stdout.trim().split('\n')[0];
  }
  return null;
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[k] = true;
      } else {
        flags[k] = next;
        i++;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function inferTrackId(promptText, tracks) {
  const s = String(promptText || '').toLowerCase();
  for (const t of tracks) {
    const keywords = [];
    if (t.title) {
      keywords.push(t.title.toLowerCase());
      t.title.split(/[\s·、/与和\-_]+/).forEach((seg) => {
        if (seg.length >= 2) keywords.push(seg.toLowerCase());
      });
    }
    if (keywords.some((kw) => kw && s.includes(kw))) {
      return t.id;
    }
  }
  return null;
}

function cleanPhoneReply(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\s*```[a-z]*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function buildMainPrompt({ prompt, source, hubRoot, mainLabel = '主力' }) {
  return [
    `【${source}手机远程转交任务】`,
    `你现在是用户的核心主力搭档「${mainLabel}」（Antigravity），请按正常工作链路处理下面这条来自手机端的指令：`,
    '1. 严格遵守工作区 AGENTS.md 守则与所有红线（默认快速定位：先读事情总表.md 及最相关的 2-3 个核心文件；绝不碰 .env / *.sqlite3 / 密钥 / 生产库写入；改任何已有文件前必须先备份原件）；',
    `2. 动脑分析并推进；如果用户在手机上交代「记一下/提醒我/别忘了」，直接执行 node "${path.join(hubRoot, 'bin', 'hub-ctl.mjs')}" memory add "<内容>" --source mobile 落盘并反馈识别出的到期日；如果涉及批量读文件/整理体力活，可按多AI中枢流程调 node "${path.join(hubRoot, 'bin', 'hub-ctl.mjs')}" dispatch --slot worker 派给黑奴处理并验收；`,
    `3. 输出给手机端看的最终答复：以「${mainLabel}」的身份用**大白话**直接说清结论、关键数字和下一步，像靠谱搭档发微信一样自然好读，不要堆砌专业术语、不要长篇表格或大段代码，控制在 3-8 行以内即可。`,
    '',
    '--- 用户的原始指令 ---',
    prompt,
  ].join('\n');
}

function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const agyBin = resolveAgyBinary();

  if (pos[0] === 'health') {
    if (!agyBin) {
      console.log(JSON.stringify({ ok: false, error: '未找到官方 agy 命令行，请先安装 Antigravity CLI' }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, agyBin, mode: 'agy-cli-direct' }, null, 2));
    return;
  }

  const userPrompt = (flags.prompt || pos.join(' ') || '').trim();
  if (!userPrompt) {
    console.error('缺少任务内容。用法: node ask-main.mjs "<要交给主力办的事>"');
    process.exit(1);
  }

  if (!agyBin) {
    console.log('⚠️ 本机未检测到官方 agy 命令行，暂时无法直连 Antigravity 主力。请在电脑上安装 agy 后重试。');
    process.exit(1);
  }

  const P = getHubPaths();
  const cfg = loadConfig();
  const workspaceRoot = path.resolve(P.hubRoot, cfg.workspaceRoot || '../..');
  const source = String(flags.source || '手机秘书').trim();
  const mainLabel = String(cfg?.slots?.orchestrator?.label || '主力').trim();
  const timeoutSec = Math.max(20, Math.min(600, Number(flags.timeout) || 240));
  const reqId = `REQ-${formatStamp()}`;

  const fullPrompt = buildMainPrompt({
    prompt: userPrompt,
    source,
    hubRoot: P.hubRoot,
    mainLabel,
  });

  const args = [
    '--mode', 'auto',
    '--print-timeout', `${timeoutSec}s`,
    `--print=${fullPrompt}`,
  ];
  if (flags.model) {
    args.unshift('--model', String(flags.model));
  }

  // Ensure common binary directories are on PATH even when invoked from non-login bot shells
  const extraPath = [
    path.dirname(agyBin),
    path.dirname(process.execPath),
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH || '',
  ].filter(Boolean).join(':');

  const start = Date.now();
  const res = spawnSync(agyBin, args, {
    cwd: workspaceRoot,
    env: { ...process.env, PATH: extraPath },
    encoding: 'utf8',
    timeout: (timeoutSec + 15) * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  const stdoutText = cleanPhoneReply(res.stdout);
  const stderrText = String(res.stderr || '').trim();
  const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  const ok = !timedOut && res.status === 0 && Boolean(stdoutText);

  // Archive full exchange under runtime/mobile-bridge/ (hidden from GitHub & home UI)
  const bridgeDir = path.join(P.runtimeDir, process.env.HUB_BRIDGE_DIR || 'mobile-bridge');
  fs.mkdirSync(bridgeDir, { recursive: true });
  const logFile = path.join(bridgeDir, `${reqId}.md`);
  const logRel = path.relative(P.runtimeDir, logFile);
  const logMd = [
    `# ${source}转主力记录：${reqId}`,
    '',
    `- **时间**：${formatLocalTime()}`,
    `- **耗时**：${durationSec}s`,
    `- **状态**：${ok ? '✅ 成功' : (timedOut ? '⏱️ 超时' : `❌ 失败 (exit ${res.status})`)}`,
    '',
    '## 用户原话',
    userPrompt,
    '',
    '## 执行产出',
    stdoutText || '（无输出）',
    ...(stderrText && !ok ? ['', '## 错误信息', '```text', stderrText.slice(0, 1500), '```'] : []),
    '',
  ].join('\n');
  fs.writeFileSync(logFile, logMd, 'utf8');

  if (!ok) {
    const errDetail = timedOut
      ? `主力处理超过 ${timeoutSec} 秒超时`
      : (stderrText.slice(0, 260) || res.error?.message || `退出码 ${res.status}`);
    console.log(`⚠️ 转交主力时出了点问题：${errDetail}`);
    process.exit(1);
  }

  // Record clean summary into ai-hub (and attach to matched mainline if obvious)
  if (!flags['no-record']) {
    try {
      const tracks = loadTracks();
      const matchedTrackId = inferTrackId(userPrompt, tracks);
      recordResult({
        title: `手机找${mainLabel}：${userPrompt.slice(0, 18)}`,
        summary: stdoutText.split('\n').filter(Boolean).slice(0, 3).join('\n').slice(0, 180),
        files: [logFile],
        by: `${mainLabel} · ${source}转交`,
        runtimeRelPath: logRel,
        trackId: matchedTrackId,
      });
    } catch {
      // non-fatal
    }
  }

  // Print ONLY the clean reply to stdout for mobile secretary to forward to user's phone
  console.log(stdoutText);
}

main();
