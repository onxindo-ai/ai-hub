import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

const app = new App({ name: '多AI中枢', version: '1.3.0' }, {});

const state = {
  hub: null,
  activeTrackId: null,         // Active track detail sub-page
  trackShowBg: false,          // Collapsible background inside track detail
  trackEditMeta: false,        // Inline editor for Goal / Latest / Next / Priority / Title
  renamingTrackId: null,       // Track ID currently being inline-renamed
  renameDraft: '',
  confirmDeleteTrackId: null,  // 2-click safety confirm for deleting a track
  archiveOldOnNew: true,       // Archive previous conversation of this track when opening a new one
  trackInputText: '',          // Single-line worker prompt inside track detail
  memoryInputText: '',         // Single-line quick memory fragment input
  showDoneMemories: false,     // Collapsible completed memories
  showVault: false,            // Collapsible local permanent vault
  vaultSearch: '',             // Live filter inside local vault
  attachedContextLabel: '',    // Active pill attached via updateModelContext
  lastSentNote: '',            // Clear feedback after action
  teamExpanded: false,         // Collapsible modular team bar (default collapsed)
  pickingSlotId: null,         // Only open picker drawer when clicking "换人/插一个"
  openDrawer: null,            // null | 'results' | 'add-track'
  busy: false,
  expandedResults: {},         // { [resultId]: true }
  resultBodies: {},            // { [resultId]: fullRawText }
  hostCaps: {},
};

const PLAIN_WORKER_RULES = [
  '严格输出要求：',
  '1. 第一段必须以【人话结论】开头，只用大白话写 1-3 句结果，像给老板发微信汇报一样通俗易懂，严禁出现专业术语、英文代码词、Markdown 标题(#)、加粗(**)或表格(|)；',
  '2. 所有专业术语、核对过程、文件路径和表格，统一另起一段写【详细记录（给AI看）】放到后面（面板默认隐藏，仅供主力 AI 查阅）；',
  '3. 直接基于上下文作答，不要扫描无关目录。',
].join('\n');

const PRIORITY_OPTIONS = [
  { value: 'P0', label: '紧急' },
  { value: 'P1', label: '重要' },
  { value: 'P2', label: '常规' },
  { value: 'P3', label: '暂缓' },
];

function priorityRank(p) {
  const m = String(p || '').toUpperCase().match(/^P(\d+)$/);
  return m ? Number(m[1]) : 99;
}

function sortTracksByPriority(tracks) {
  return [...(tracks || [])].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

function priorityLabel(p) {
  const hit = PRIORITY_OPTIONS.find((o) => o.value === p);
  return hit ? `${hit.value}（${hit.label}）` : String(p || '');
}

function renderPriorityPicker(track) {
  const cur = track.priority || 'P1';
  const hasCur = PRIORITY_OPTIONS.some((o) => o.value === cur);
  const opts = hasCur ? PRIORITY_OPTIONS : [{ value: cur, label: '当前' }, ...PRIORITY_OPTIONS];
  return `
    <span class="pri-picker-wrap" data-stop-row title="点击修改紧急程度">
      <span class="pri-tag ${esc(cur)}">${esc(cur)}<span class="pri-caret">▾</span></span>
      <select class="pri-native-select" data-action="change-priority" data-track-id="${esc(track.id)}" data-title="${esc(track.title)}" aria-label="修改紧急程度" ${state.busy ? 'disabled' : ''}>
        ${opts.map((o) => `<option value="${esc(o.value)}" ${cur === o.value ? 'selected' : ''}>${esc(o.value)} · ${esc(o.label)}</option>`).join('')}
      </select>
    </span>
  `;
}

let pollTimer = null;
function syncPolling() {
  const hasJobs = Boolean(state.hub?.activeJobs && state.hub.activeJobs.length > 0);
  if (hasJobs && !pollTimer) {
    pollTimer = setInterval(async () => {
      try {
        const prevIds = new Set((state.hub?.results || []).map((r) => r.id));
        const res = await app.callServerTool({ name: 'hub_status', arguments: {} });
        if (res?.structuredContent) {
          state.hub = res.structuredContent;
          const newest = (state.hub.results || []).find((r) => !prevIds.has(r.id));
          if (newest) showToast('✅ 黑奴已给出人话结论');
          if (!state.hub.activeJobs || state.hub.activeJobs.length === 0) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          render();
        }
      } catch {
        // ignore transient poll error
      }
    }, 3000);
  } else if (!hasJobs && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function getMainName(hub) {
  return hub?.slots?.find((s) => s.id === 'orchestrator')?.label || '主力';
}

function getWorkerName(hub) {
  return hub?.slots?.find((s) => s.id === 'worker')?.label || '黑奴';
}

function statusLabel(status) {
  if (status === 'ready') return '已就绪';
  if (status === 'missing_key') return '缺密钥';
  if (status === 'not_installed') return '未安装';
  return '空位';
}

function shortFileName(p) {
  const str = String(p || '');
  const parts = str.split('/');
  return parts[parts.length - 1] || str;
}

function displayRelPath(p, workspaceRoot) {
  const s = String(p || '');
  if (workspaceRoot && s.startsWith(workspaceRoot + '/')) {
    return s.slice(workspaceRoot.length + 1);
  }
  return s;
}

function formatShortTime(ts) {
  const s = String(ts || '').trim();
  const m = s.match(/^\d{4}-(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
}

function formatPlainConclusion(rawText) {
  let s = String(rawText || '').trim();
  if (!s) return '已完成，详情见原稿。';

  const cutIdx = s.search(
    /(?:^|\n|\s)(?:#{2,3}\s*(?:一、|二、|三、|通路|过程|详细|说明|核对|技术)|【(?:过程|详细记录[^】]*|技术细节)】|(?:过程|详细记录)[：:])/
  );
  if (cutIdx > 0) s = s.slice(0, cutIdx);

  const conclMatch = s.match(
    /(?:【(?:人话结论|一句话结论|结论)】|\*\*(?:人话结论|先给结论|结论)\*\*[：:]?|(?:人话结论|先给结论|结论)[：:])\s*([\s\S]+)/
  );
  if (conclMatch) s = conclMatch[1];

  const tableIdx = s.search(/\s\|[^|]+\|\s*\|[-:\s|]+\|/);
  if (tableIdx > 0) s = s.slice(0, tableIdx);

  const lines = s
    .replace(/\s+##\s+/g, '\n')
    .replace(/\s+-\s+/g, '\n')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l) && !/^\s*---+\s*$/.test(l) && !/^\s*```/.test(l))
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

  const out = lines.slice(0, 3).join('\n');
  if (!out) return '已完成，详情见原稿。';
  return out.length > 180 ? out.slice(0, 179) + '…' : out;
}

async function callTool(name, args = {}) {
  state.busy = true;
  render();
  try {
    return await app.callServerTool({ name, arguments: args });
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshStatus() {
  try {
    const res = await callTool('hub_status', {});
    if (res?.structuredContent) {
      state.hub = res.structuredContent;
      render();
    }
  } catch (e) {
    showToast(`刷新失败：${e.message}`);
  }
}

async function swapSlot(slotId, adapterId) {
  try {
    const res = await callTool('hub_set_slot', { slotId, adapterId });
    if (res?.isError) {
      showToast(res.content?.[0]?.text || '更换失败');
      return;
    }
    if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
    state.pickingSlotId = null;
    showToast(res?.structuredContent?.action?.message || '已更新班子');
    render();
  } catch (e) {
    showToast(`更换失败：${e.message}`);
  }
}

async function commitInlineRename(trackId) {
  const input = document.getElementById('inline-rename-input');
  const nextTitle = (input ? input.value : state.renameDraft).trim();
  if (!nextTitle) {
    showToast('标题不能为空');
    input?.focus();
    return;
  }
  const res = await callTool('hub_update_track_meta', { trackId, title: nextTitle });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  state.renamingTrackId = null;
  state.renameDraft = '';
  showToast(`✅ 已改名为「${nextTitle}」`);
  render();
}

async function changeTrackPriority(trackId, nextPriority, trackTitle) {
  if (!trackId || !nextPriority) return;
  const current = (state.hub?.tracks || []).find((t) => t.id === trackId);
  if (current && current.priority === nextPriority) return;
  try {
    const res = await callTool('hub_update_track_meta', { trackId, priority: nextPriority });
    if (res?.isError) {
      showToast(res.content?.[0]?.text || '修改紧急程度失败');
      return;
    }
    if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
    showToast(`✅ 「${trackTitle || current?.title || '主线'}」已调为 ${priorityLabel(nextPriority)}`);
    render();
  } catch (e) {
    showToast(`修改失败：${e.message}`);
  }
}

let deleteConfirmTimer = null;
async function requestDeleteTrack(trackId, trackTitle) {
  if (state.confirmDeleteTrackId !== trackId) {
    state.confirmDeleteTrackId = trackId;
    clearTimeout(deleteConfirmTimer);
    deleteConfirmTimer = setTimeout(() => {
      if (state.confirmDeleteTrackId === trackId) {
        state.confirmDeleteTrackId = null;
        render();
      }
    }, 4000);
    render();
    return;
  }
  clearTimeout(deleteConfirmTimer);
  state.confirmDeleteTrackId = null;
  const res = await callTool('hub_delete_track', { trackId });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  if (state.activeTrackId === trackId) {
    state.activeTrackId = null;
    state.trackShowBg = false;
    state.trackEditMeta = false;
  }
  showToast(`已删除主线「${trackTitle || ''}」`);
  render();
}

async function handoverCurrentChat() {
  const hub = state.hub;
  const mainName = getMainName(hub);
  const canMsg = Boolean(state.hostCaps?.message);
  if (canMsg) {
    try {
      await app.sendMessage({
        role: 'user',
        content: [{
          type: 'text',
          text: `${mainName}，请帮我把当前这条对话一键无感换新：先把刚才的结论和进度落盘，再调用 hub-ctl.mjs handover 创建接棒新对话并自动归档本条老对话，把新对话入口链接发给我。`,
        }],
      });
      state.lastSentNote = `🔄 已让左侧${mainName}落盘进度、建接棒新对话并自动归档老对话。`;
      render();
      return;
    } catch (e) {
      showToast(`换新失败：${e.message}`);
      return;
    }
  }
  const res = await callTool('hub_handover_conversation', {
    title: `${mainName} · 续接对话`,
    summary: '承接上一阶段已落盘的进度。',
    files: '事情总表.md,协作与工具/多AI中枢/runtime/进度简报.md',
    nextSteps: '先读最新进度，告诉我当前重点和下一步。',
    archiveCurrent: false,
  });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  state.lastSentNote = '✨ 已在左侧列表顶部建好接棒新对话，点过去接着聊即可。';
  render();
}

async function toggleResultReply(resultId, filePath, runtimeRelPath, forceOpen = false) {
  if (!forceOpen && state.expandedResults[resultId]) {
    delete state.expandedResults[resultId];
    render();
    return;
  }
  if (runtimeRelPath) {
    if (!state.resultBodies[resultId]) {
      try {
        const res = await callTool('hub_read_runtime_file', { relPath: runtimeRelPath });
        if (res?.structuredContent?.content) {
          const raw = res.structuredContent.content;
          const idx = raw.indexOf('## 执行产出');
          state.resultBodies[resultId] = idx >= 0 ? raw.slice(idx + '## 执行产出'.length).trim() : raw;
        }
      } catch (e) {
        showToast(`读取失败：${e.message}`);
        return;
      }
    }
    state.expandedResults[resultId] = true;
    render();
    return;
  }
  try {
    await navigator.clipboard?.writeText(filePath || '');
    showToast(`📋 已复制路径：${shortFileName(filePath)}`);
  } catch {
    showToast(`文件路径：${filePath}`);
  }
}

async function addTrack() {
  const title = document.getElementById('trk-title')?.value.trim() || '';
  const priority = document.getElementById('trk-pri')?.value || 'P1';
  const goal = document.getElementById('trk-goal')?.value.trim() || '';
  const status = document.getElementById('trk-status')?.value.trim() || '';
  const next = document.getElementById('trk-next')?.value.trim() || '';
  if (!title) {
    showToast('先写一下这条主线的名称');
    return;
  }
  const res = await callTool('hub_add_track', { priority, title, goal, status, next });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  state.openDrawer = null;
  showToast(`✅ 已添加主线：${title}`);
  render();
}

async function saveTrackMeta(trackId) {
  const title = document.getElementById('edit-title')?.value.trim() || '';
  const priority = document.getElementById('edit-pri')?.value || '';
  const goal = document.getElementById('edit-goal')?.value.trim() || '';
  const latest = document.getElementById('edit-latest')?.value.trim() || '';
  const next = document.getElementById('edit-next')?.value.trim() || '';
  const payload = { trackId, goal, latest, next };
  if (title) payload.title = title;
  if (priority) payload.priority = priority;
  const res = await callTool('hub_update_track_meta', payload);
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  state.trackEditMeta = false;
  showToast('✅ 已保存');
  render();
}

async function dispatchTrackWorker(track) {
  const hub = state.hub;
  const workerName = getWorkerName(hub);
  const input = document.getElementById('track-worker-input');
  const q = (input ? input.value : state.trackInputText).trim();
  if (!q) {
    showToast(`先写一下要${workerName}查什么`);
    input?.focus();
    return;
  }
  state.trackInputText = '';
  render();
  const prevReply = (state.hub?.results || []).find(
    (r) => r.trackId === track.id || (r.title && r.title.includes(track.title.slice(0, 4)))
  );
  const contextHint = [
    `主线名称：${track.title}`,
    track.goal ? `最终目标：${track.goal}` : '',
    track.latest ? `当前进度：${track.latest}` : '',
    prevReply?.summary ? `上一版人话结论：${formatPlainConclusion(prevReply.summary)}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await callTool('hub_dispatch_task', {
      title: `${track.title.slice(0, 14)} · 回复`,
      prompt: `${contextHint}\n\n用户最新要求：${q}\n\n${PLAIN_WORKER_RULES}`,
      slot: 'worker',
      mode: 'read-only',
      noWeb: true,
      trackId: track.id,
      async: true,
    });
    if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
    if (res?.isError) {
      showToast(res.content?.[0]?.text || '派活失败');
    } else {
      showToast(`🐳 已派给${workerName}，完成后结论会显示在下方`);
      syncPolling();
    }
    render();
  } catch (e) {
    showToast(`派活失败：${e.message}`);
  }
}

async function openTrackNewConversation(track) {
  const hub = state.hub;
  const mainName = getMainName(hub);
  const canMsg = Boolean(state.hostCaps?.message);
  const wantArchive = Boolean(state.archiveOldOnNew);
  const files = (track.keyFiles && track.keyFiles.length)
    ? ['事情总表.md', ...track.keyFiles.slice(0, 2)].join(',')
    : '事情总表.md';
  const text = `继续跟进主线「${track.title}」${track.next ? `，下一步重点：${track.next}` : ''}。请先读相关进度，直接用大白话告诉我下一步方案。`;

  if (wantArchive && canMsg) {
    try {
      const title = `${track.title} · 续接`;
      const summary = track.latest || track.status || track.goal || track.title;
      const nextSteps = track.next || `继续推进主线「${track.title}」`;
      await app.sendMessage({
        role: 'user',
        content: [{
          type: 'text',
          text: `${mainName}，请帮我为主线「${track.title}」一键换新对话并归档旧对话：先把本轮最新结论落盘，再执行 \`node 协作与工具/多AI中枢/bin/hub-ctl.mjs handover --track-id "${track.id}" --title "${title}" --summary "${summary}" --files "${files}" --next "${nextSteps}"\`（会自动建好接棒新对话、绑定主线并精准归档左侧旧对话），最后把新对话入口链接发给我。`,
        }],
      });
      state.lastSentNote = `🔄 已让左侧${mainName}落盘接棒、建新对话并自动归档旧对话。`;
      render();
      return;
    } catch (e) {
      showToast(`触发失败：${e.message}`);
      return;
    }
  }

  if (canMsg) {
    try {
      const msgRes = await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text }],
        _meta: { 'com.google.antigravity/message': { target: 'new' } },
      });
      const newId = msgRes?._meta?.['com.google.antigravity/message']?.conversationId;
      if (newId) {
        const bindRes = await callTool('hub_bind_track_conversation', {
          trackId: track.id,
          conversationId: newId,
          archivePrevious: false,
        });
        if (bindRes?.structuredContent?.status) state.hub = bindRes.structuredContent.status;
      }
      state.lastSentNote = '✨ 已在左侧顶部新建本主线独立对话，点过去就能看回复。';
      render();
      return;
    } catch {
      // fall through to server handover
    }
  }

  const res = await callTool('hub_handover_conversation', {
    title: track.title.slice(0, 20),
    summary: track.latest || track.status || track.title,
    files,
    nextSteps: text,
    trackId: track.id,
    archiveCurrent: wantArchive,
  });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  const r = res?.structuredContent?.result || {};
  state.lastSentNote = r.archivedOld
    ? '✨ 已建好本主线新对话，并自动归档了上一条旧对话。'
    : (wantArchive
      ? '✨ 已生成交接单（当前视图无法直接归档左侧对话，请在对话侧边栏点开新对话或手动归档）。'
      : '✨ 已在左侧列表顶部建好本主线新对话，点过去就能看回复。');
  render();
}

function renderTracks(hub) {
  const tracks = sortTracksByPriority(hub.tracks || []);
  if (tracks.length === 0) {
    return `
      <div class="empty-results">
        还没有主线任务，点右上角「+ 新建」记上你正在跟的几件事。
      </div>
    `;
  }
  return `
    <div class="tracks-list">
      ${tracks.map((t) => `
        <div class="track-row" data-action="open-track" data-track-id="${esc(t.id)}">
          ${renderPriorityPicker(t)}
          <div class="track-main">
            <span class="track-title">${esc(t.title)}</span>
          </div>
          <div class="track-row-actions">
            <span class="track-chevron">›</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function attachToNextMessage(label, contextText) {
  if (!state.hostCaps?.updateModelContext) {
    showToast('仅在对话右侧边栏打开时支持挂入输入框');
    return;
  }
  try {
    await app.updateModelContext({
      content: [{ type: 'text', text: contextText }],
    });
    state.attachedContextLabel = label;
    showToast(`📎 已挂到左侧输入框，发下一句话时自动带上`);
    render();
  } catch (e) {
    showToast(`挂载失败：${e.message}`);
  }
}

async function clearAttachedContext() {
  if (!state.hostCaps?.updateModelContext) {
    state.attachedContextLabel = '';
    render();
    return;
  }
  try {
    await app.updateModelContext({ content: [] });
  } catch {
    // ignore
  }
  state.attachedContextLabel = '';
  render();
}

async function addMemoryItem() {
  const input = document.getElementById('mem-quick-input');
  const text = (input ? input.value : state.memoryInputText).trim();
  if (!text) {
    input?.focus();
    return;
  }
  state.memoryInputText = '';
  const res = await callTool('hub_add_memory', { text, source: 'panel' });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  const r = res?.structuredContent?.result;
  if (r?.routedTo === 'vault') {
    state.showVault = true;
    showToast('📌 识别为重要记录，已永久存入本机「重要记录」文件夹');
  } else {
    showToast(r?.item?.dueDate ? `✅ 已记下（自动设提醒：${r.item.dueDate}）` : '✅ 已记入临时碎片');
  }
  render();
}

async function promoteMemoryItem(memoryId) {
  const res = await callTool('hub_promote_memory', { memoryId });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  state.showVault = true;
  showToast('📌 已转存到本机「重要记录」文件夹（永不随碎片清理）');
  render();
}

async function removeVaultItem(recordId) {
  const res = await callTool('hub_delete_vault', { recordId });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  showToast('已删除该条重要记录');
  render();
}

async function openLocalVaultFolder() {
  try {
    const res = await callTool('hub_open_vault', {});
    const dir = res?.structuredContent?.vaultDir || 'runtime/重要记录';
    showToast(`📂 已打开本地文件夹：${dir}`);
  } catch (e) {
    showToast(`打开失败：${e.message}`);
  }
}

async function toggleMemoryItem(memoryId, forceDone = undefined) {
  const args = forceDone === undefined ? { memoryId } : { memoryId, done: forceDone };
  const res = await callTool('hub_toggle_memory', args);
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  render();
}

async function removeMemoryItem(memoryId) {
  const res = await callTool('hub_delete_memory', { memoryId });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  render();
}

async function tidyMemoriesWithWorker() {
  try {
    const res = await callTool('hub_tidy_memories', {});
    if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
    if (res?.isError) {
      showToast(res.content?.[0]?.text || '发起整理失败');
    } else {
      showToast('🐳 黑奴正在后台整理碎片，几秒后呈现采纳方案');
      syncPolling();
    }
    render();
  } catch (e) {
    showToast(`整理失败：${e.message}`);
  }
}

async function applyTidyProposal(accept) {
  const res = await callTool('hub_apply_memory_tidy', { accept: Boolean(accept) });
  if (res?.structuredContent?.status) state.hub = res.structuredContent.status;
  showToast(accept ? '✅ 已采纳整理方案' : '已忽略本次整理');
  render();
}

function formatDueBadge(dueDate) {
  if (!dueDate) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const m = String(dueDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { label: dueDate, cls: 'due' };
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const diff = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) return { label: `过期${Math.abs(diff)}天`, cls: 'overdue' };
  if (diff === 0) return { label: '今天', cls: 'due' };
  if (diff === 1) return { label: '明天', cls: 'due' };
  return { label: `${m[2]}-${m[3]}`, cls: 'due' };
}

function renderReminders(hub) {
  const list = hub.reminders || [];
  if (list.length === 0) return '';
  return `
    <div class="reminder-box">
      <div class="reminder-head">
        <span>⏰ 防遗忘提醒（${list.length}）</span>
        <span style="font-weight:400;opacity:.8">处理完自动消失</span>
      </div>
      ${list.slice(0, 5).map((r) => `
        <div class="reminder-row">
          <span class="rem-badge ${esc(r.level)}">${esc(r.badge)}</span>
          <span class="rem-title" title="${esc(r.title)}">${esc(r.title)}</span>
          ${r.targetType === 'memory'
            ? `<button class="text-btn" style="padding:2px 6px;font-size:11.5px" data-action="rem-done-mem" data-mem-id="${esc(r.targetId)}" ${state.busy ? 'disabled' : ''}>✓ 划掉</button>`
            : `<button class="text-btn" style="padding:2px 6px;font-size:11.5px" data-action="open-track" data-track-id="${esc(r.targetId)}">去看 ›</button>`}
        </div>
      `).join('')}
    </div>
  `;
}

function renderMemoriesSection(hub, canCtx) {
  const all = hub.memories || [];
  const active = all.filter((m) => !m.done);
  const done = all.filter((m) => m.done);
  const vault = hub.vaultRecords || [];
  const kw = state.vaultSearch.trim().toLowerCase();
  const filteredVault = kw
    ? vault.filter((v) => `${v.text} ${v.category}`.toLowerCase().includes(kw))
    : vault;
  const workerSlot = hub.slots.find((s) => s.id === 'worker');
  const workerReady = Boolean(workerSlot?.mounted && workerSlot.mounted.status === 'ready');
  const workerName = getWorkerName(hub);
  const proposal = hub.memoryTidyProposal;

  return `
    <div class="section-block">
      <div class="sec-head">
        <div class="sec-title">碎片记忆 ${active.length > 0 ? `<span style="color:var(--fg-3);font-weight:400">(${active.length})</span>` : ''}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="${state.showVault ? 'active-pill' : 'text-btn'}" id="btn-toggle-vault" title="永久存在本机文件夹，不随临时碎片清理、不外发">
            📌 重要本${vault.length > 0 ? ` (${vault.length})` : ''} ${state.showVault ? '▴' : '▾'}
          </button>
          ${workerReady && active.length >= 3 ? `
            <button class="text-btn" id="btn-tidy-memories" ${state.busy ? 'disabled' : ''} title="派${esc(workerName)}后台去重合并整理普通临时碎片">
              ${esc(workerSlot.mounted.icon)} 理一下
            </button>
          ` : ''}
          ${done.length > 0 ? `
            <button class="text-btn" id="btn-toggle-done-mem">
              已划掉 (${done.length}) ${state.showDoneMemories ? '▴' : '▾'}
            </button>
          ` : ''}
        </div>
      </div>

      <div class="mem-input-bar">
        <input type="text" id="mem-quick-input" value="${esc(state.memoryInputText)}" placeholder="随手记一句（带日期自动设提醒，账号/密码自动存本地重要本）…" />
        <button class="soft" id="btn-add-memory" ${state.busy ? 'disabled' : ''}>记下</button>
      </div>

      ${state.showVault ? `
        <div class="vault-box">
          <div class="vault-head">
            <span>📌 仅存本机文件夹（永不清理 · 不发给云端模型）</span>
            <button class="text-btn" id="btn-open-vault" style="padding:2px 6px;font-size:11.5px">📂 打开文件夹</button>
          </div>
          ${vault.length > 0 ? `
            <div class="vault-search">
              <input type="text" id="vault-search-input" value="${esc(state.vaultSearch)}" placeholder="搜账号、邮箱或关键词…" />
            </div>
            <div class="vault-list">
              ${filteredVault.length > 0 ? filteredVault.map((v) => `
                <div class="vault-row">
                  <span class="vault-cat">${esc(v.category || '重要')}</span>
                  <div class="mem-body">
                    <span class="mem-text">${esc(v.text)}</span>
                  </div>
                  <div class="mem-actions">
                    <button class="icon-btn" data-action="copy-vault" data-text="${esc(v.text)}" title="复制">📋</button>
                    <button class="icon-btn" data-action="delete-vault" data-vault-id="${esc(v.id)}" title="删除">✕</button>
                  </div>
                </div>
              `).join('') : '<div style="padding:10px;font-size:12px;color:var(--fg-3);text-align:center">没有匹配的记录</div>'}
            </div>
          ` : '<div style="font-size:12px;color:var(--fg-3)">暂无重要记录：在上方直接输入含「账号 / 密码 / Apple ID / 重要」的内容会自动存入这里，或点下方碎片右侧的 📌 转存。</div>'}
        </div>
      ` : ''}

      ${proposal ? `
        <div class="mem-tidy-card">
          <div class="mem-tidy-head">
            <span>🐳 ${esc(proposal.by || workerName)}已整理好：${esc(proposal.summary)}</span>
          </div>
          <ul class="mem-tidy-list">
            ${proposal.items.map((it) => `
              <li>${esc(it.text)}${it.dueDate ? ` <span class="mem-pill due">${esc(it.dueDate)}</span>` : ''}</li>
            `).join('')}
          </ul>
          <div style="display:flex;justify-content:flex-end;gap:6px">
            <button class="text-btn" data-action="apply-tidy" data-accept="0" ${state.busy ? 'disabled' : ''}>忽略</button>
            <button class="primary" style="padding:4px 10px" data-action="apply-tidy" data-accept="1" ${state.busy ? 'disabled' : ''}>✅ 采纳整理</button>
          </div>
        </div>
      ` : ''}

      ${active.length > 0 ? `
        <div class="mem-list">
          ${active.map((m) => {
            const due = formatDueBadge(m.dueDate);
            return `
              <div class="mem-row">
                <button class="mem-check" data-action="toggle-mem" data-mem-id="${esc(m.id)}" title="划掉完成">✓</button>
                <div class="mem-body">
                  <span class="mem-text">${esc(m.text)}</span>
                  ${due ? `<span class="mem-pill ${esc(due.cls)}">⏰ ${esc(due.label)}</span>` : ''}
                  ${m.tag && m.tag !== '备忘' && !due ? `<span class="mem-pill">${esc(m.tag)}</span>` : ''}
                </div>
                <div class="mem-actions">
                  <button class="icon-btn" data-action="promote-mem" data-mem-id="${esc(m.id)}" title="转存为本机永久重要记录">📌</button>
                  ${canCtx ? `<button class="icon-btn" data-action="attach-mem" data-mem-id="${esc(m.id)}" title="挂到左侧聊天输入框（不乱发消息）">📎</button>` : ''}
                  <button class="icon-btn" data-action="delete-mem" data-mem-id="${esc(m.id)}" title="删除">✕</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${state.showDoneMemories && done.length > 0 ? `
        <div class="mem-list" style="margin-top:4px">
          ${done.slice(0, 12).map((m) => `
            <div class="mem-row done">
              <button class="mem-check checked" data-action="toggle-mem" data-mem-id="${esc(m.id)}" title="取消划掉">✓</button>
              <div class="mem-body">
                <span class="mem-text">${esc(m.text)}</span>
              </div>
              <div class="mem-actions">
                <button class="icon-btn" data-action="delete-mem" data-mem-id="${esc(m.id)}" title="彻底删除">✕</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderTrackDetailPage(hub, track) {
  const workerName = getWorkerName(hub);
  const workerSlot = hub.slots.find((s) => s.id === 'worker');
  const workerReady = Boolean(workerSlot?.mounted && workerSlot.mounted.status === 'ready');
  const canCtx = Boolean(state.hostCaps?.updateModelContext);
  const isRenaming = state.renamingTrackId === track.id;

  const relatedResults = (hub.results || []).filter(
    (r) => r.trackId === track.id || (r.title && r.title.includes(track.title.slice(0, 4)))
  );

  return `
    <div class="page-stack">
      <!-- Quiet Top Nav -->
      <div class="detail-nav">
        <button class="text-btn" id="btn-back-home" style="padding-left:2px;color:var(--fg-2);font-weight:600">← 返回</button>
        <div class="detail-nav-right">
          <button class="${state.trackShowBg ? 'active-pill' : 'text-btn'}" id="btn-toggle-bg">背景 ${state.trackShowBg ? '▴' : '▾'}</button>
          <button class="${state.confirmDeleteTrackId === track.id ? 'confirm-danger' : 'ghost-danger'}" id="btn-detail-delete" ${state.busy ? 'disabled' : ''}>
            ${state.confirmDeleteTrackId === track.id ? '确认删除' : '删除'}
          </button>
        </div>
      </div>

      <!-- Hero Title + Inline Rename -->
      <div class="detail-hero">
        ${renderPriorityPicker(track)}
        ${isRenaming ? `
          <div class="inline-rename-wrap">
            <input type="text" id="inline-rename-input" value="${esc(state.renameDraft)}" placeholder="输入新的主线标题" />
            <button class="primary" style="padding:4px 10px" data-action="save-rename" data-track-id="${esc(track.id)}" ${state.busy ? 'disabled' : ''}>保存</button>
            <button style="padding:4px 8px" data-action="cancel-rename">取消</button>
          </div>
        ` : `
          <h2 class="detail-hero-title" id="btn-hero-rename" title="点击重命名">${esc(track.title)}</h2>
          <button class="icon-btn" id="btn-hero-rename-icon" title="重命名">✎</button>
        `}
      </div>

      <!-- Unified Calm Overview Card (Full Non-Truncated Progress) -->
      <div class="overview-card">
        <div class="overview-head">
          <span class="overview-head-title">主线概览</span>
          <button class="text-btn" id="btn-toggle-edit">${state.trackEditMeta ? '收起' : '编辑'}</button>
        </div>
        ${state.trackEditMeta ? `
          <div style="padding:12px 14px;background:var(--bg-2)">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <div style="width:108px">
                <label style="margin-top:0">紧急程度</label>
                <select id="edit-pri" class="field">
                  ${PRIORITY_OPTIONS.map((o) => `<option value="${esc(o.value)}" ${track.priority === o.value ? 'selected' : ''}>${esc(o.value)} · ${esc(o.label)}</option>`).join('')}
                </select>
              </div>
              <div style="flex:1;min-width:150px">
                <label style="margin-top:0">主线标题</label>
                <input type="text" id="edit-title" value="${esc(track.title)}" />
              </div>
            </div>
            <label>最终目标</label>
            <input type="text" id="edit-goal" value="${esc(track.goal || track.title)}" />
            <label>最新进度</label>
            <input type="text" id="edit-latest" value="${esc(track.latest || track.status || '')}" />
            <label>下一步要做什么</label>
            <input type="text" id="edit-next" value="${esc(track.next || '')}" />
            <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px">
              <button id="btn-cancel-edit">取消</button>
              <button class="primary" id="btn-save-meta" ${state.busy ? 'disabled' : ''}>保存</button>
            </div>
          </div>
        ` : `
          <div class="overview-row">
            <div class="overview-label">目标</div>
            <div class="overview-val">${esc(track.goal || track.title)}</div>
          </div>
          <div class="overview-row">
            <div class="overview-label">进度</div>
            <div class="overview-val muted">${esc(track.latest || track.status || '暂无进度记录')}</div>
          </div>
          <div class="overview-row next-row">
            <div class="overview-label">下一步</div>
            <div class="overview-val">${esc(track.next || '待确定下一步')}</div>
          </div>
        `}
      </div>

      ${state.trackShowBg ? `
        <div class="detail-section">
          ${(track.details && track.details.length > 0) ? track.details.map((g) => `
            <div class="detail-group">
              <div class="detail-group-label">${esc(g.label)}</div>
              <ul>${g.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
            </div>
          `).join('') : '<div style="font-size:12px;color:var(--fg-3)">暂无更多背景记录</div>'}
          ${(track.keyFiles && track.keyFiles.length > 0) ? `
            <div class="detail-group" style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border)">
              <div class="detail-group-label">关联文件（供 AI 读，点一下复制路径）</div>
              <div class="result-files">
                ${track.keyFiles.map((fp) => `
                  <button class="file-pill" data-action="copy-path" data-path="${esc(fp)}">📄 ${esc(fp)}</button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Minimal Track Actions (Zero Mode-Switching) -->
      <div class="action-strip">
        <label class="archive-opt">
          <input type="checkbox" id="chk-archive-old" ${state.archiveOldOnNew ? 'checked' : ''} />
          <span>顺手归档旧对话</span>
        </label>
        <div style="display:flex;align-items:center;gap:6px">
          ${canCtx ? `<button class="soft" id="btn-attach-track" title="把这条主线背景静默挂到左侧聊天输入框，发下句话自动带上">📎 挂到输入框</button>` : ''}
          <button class="primary" id="btn-track-new" ${state.busy ? 'disabled' : ''}>✨ 开新对话</button>
        </div>
      </div>

      ${state.attachedContextLabel ? `
        <div class="ctx-banner">
          <span>📎 已挂到左侧输入框：${esc(state.attachedContextLabel)}</span>
          <button class="text-btn" data-action="clear-ctx">取消</button>
        </div>
      ` : ''}

      ${workerReady ? `
        <div class="worker-bar">
          <input type="text" id="track-worker-input" value="${esc(state.trackInputText)}" placeholder="让${esc(workerName)}后台查点东西，结论回在下方…" />
          <button class="soft" id="btn-track-worker" ${state.busy ? 'disabled' : ''}>${esc(workerSlot.mounted.icon)} 派给${esc(workerName)}</button>
        </div>
      ` : ''}

      ${state.lastSentNote ? `
        <div class="sent-card">
          <span>${esc(state.lastSentNote)}</span>
          <button class="text-btn" data-action="dismiss-sent">知道了</button>
        </div>
      ` : ''}

      <!-- Live Running Jobs for this Track -->
      ${(() => {
        const trackJobs = (hub.activeJobs || []).filter((j) => j.trackId === track.id);
        if (trackJobs.length === 0) return '';
        return trackJobs.map((j) => {
          const secs = Math.max(1, Math.round((Date.now() - (j.startedAtMs || Date.now())) / 1000));
          return `
            <div class="live-strip">
              <span>⏳ ${esc(j.adapterName)} 正在后台处理（${secs}秒）</span>
              <span style="color:var(--fg-3)">完成后自动显示在下方</span>
            </div>
          `;
        }).join('');
      })()}

      <!-- Plain-Language Conclusions -->
      ${relatedResults.length > 0 ? `
        <div class="section-block">
          <div class="sec-head">
            <div class="sec-title">最新结论</div>
            <div class="sec-sub">人话要点 · 原稿留给 AI</div>
          </div>
          <div class="conclusions-card">
            ${relatedResults.map((r) => {
              const isOpen = Boolean(state.expandedResults[r.id]);
              const plain = formatPlainConclusion(r.summary);
              const firstFile = (r.files && r.files[0]) || '';
              return `
                <div class="conclusion-item">
                  <div class="conclusion-top">
                    <div class="conclusion-meta">
                      <span class="role-pill">${esc(r.by || mainName)}</span>
                      <span>${esc(formatShortTime(r.createdAt))}</span>
                    </div>
                    ${(r.runtimeRelPath || firstFile) ? `
                      <button class="text-btn" data-action="open-result"
                              data-id="${esc(r.id)}"
                              data-file="${esc(firstFile)}"
                              data-rel="${esc(r.runtimeRelPath || '')}">
                        ${r.runtimeRelPath ? (isOpen ? '收起原稿 ▴' : '看原稿 ▾') : '复制路径'}
                      </button>
                    ` : ''}
                  </div>
                  <div class="conclusion-text">${esc(plain)}</div>
                  ${isOpen && state.resultBodies[r.id] ? `<pre class="preview-box">${esc(state.resultBodies[r.id])}</pre>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderTopDrawer(hub) {
  const mainName = getMainName(hub);
  if (state.openDrawer === 'results') {
    const results = hub.results || [];
    return `
      <div class="drawer-box">
        <h3>
          <span>📦 成品与文件入口（供 AI 查阅）</span>
          <button class="text-btn" data-action="close-drawer">收起</button>
        </h3>
        <div style="font-size:11.5px;color:var(--fg-3)">平时不用管这里，成品文件会自动留档，需要让${esc(mainName)}读或复查时再点开。</div>
        ${results.length === 0 ? `
          <div class="empty-results" style="margin-top:8px">暂无归档成品记录</div>
        ` : `
          <div class="archive-list">
            ${results.map((r) => {
              const isOpen = Boolean(state.expandedResults[r.id]);
              return `
                <div class="archive-row">
                  <div class="archive-row-head">
                    <strong style="font-size:12.5px">${esc(r.title)}</strong>
                    <span style="font-size:11px;color:var(--fg-3)">${esc(r.by || mainName)} · ${esc(formatShortTime(r.createdAt))}</span>
                  </div>
                  <div style="font-size:12px;color:var(--fg-2);white-space:pre-line">${esc(formatPlainConclusion(r.summary))}</div>
                  ${(r.files && r.files.length > 0) ? `
                    <div class="result-files">
                      ${r.files.map((fp) => `
                        <button class="file-pill" data-action="open-result"
                                data-id="${esc(r.id)}"
                                data-file="${esc(fp)}"
                                data-rel="${esc(r.runtimeRelPath || '')}">
                          ${r.runtimeRelPath
                            ? (isOpen ? '▴ 收起原稿' : '📄 看原稿 ▾')
                            : `📄 ${esc(displayRelPath(fp, hub.workspaceRoot))}`}
                        </button>
                      `).join('')}
                    </div>
                  ` : ''}
                  ${isOpen && state.resultBodies[r.id] ? `<pre class="preview-box">${esc(state.resultBodies[r.id])}</pre>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  if (state.openDrawer === 'add-track') {
    return `
      <div class="drawer-box">
        <h3>
          <span>新建主线</span>
          <button class="text-btn" data-action="close-drawer">收起</button>
        </h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div style="width:108px">
            <label>紧急程度</label>
            <select id="trk-pri" class="field">
              ${PRIORITY_OPTIONS.map((o) => `<option value="${esc(o.value)}" ${o.value === 'P1' ? 'selected' : ''}>${esc(o.value)} · ${esc(o.label)}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;min-width:160px">
            <label>主线名称</label>
            <input type="text" id="trk-title" placeholder="例如：新版文档整理与发布准备" />
          </div>
        </div>
        <label>最终目标</label>
        <input type="text" id="trk-goal" placeholder="例如：2027-04-10 前确定独立经营方案" />
        <label>最新进度</label>
        <input type="text" id="trk-status" placeholder="例如：11月数据已滚到24日，等整月结账" />
        <label>下一步要做什么</label>
        <input type="text" id="trk-next" placeholder="例如：12月初重算整月基准" />
        <div style="display:flex;justify-content:flex-end;margin-top:10px">
          <button class="primary" id="btn-save-track" ${state.busy ? 'disabled' : ''}>保存</button>
        </div>
      </div>
    `;
  }
  return '';
}

function renderPickerDrawer(hub) {
  if (!state.pickingSlotId) return '';
  const slot = hub.slots.find((s) => s.id === state.pickingSlotId);
  if (!slot) return '';
  const accepts = slot.accepts || [];
  const candidates = hub.adapters.filter((a) => accepts.length === 0 || accepts.includes(a.kind));

  return `
    <div class="picker-drawer">
      <div class="picker-head">
        <div style="font-weight:700;font-size:12.5px">给「${esc(slot.label)}」挑一个 AI（点一下或拖进卡片）</div>
        <button class="text-btn" data-action="close-picker">取消</button>
      </div>
      <div class="picker-grid">
        ${candidates.map((a) => {
          const isCurrent = slot.adapter === a.id;
          return `
            <div class="candidate-card ${isCurrent ? 'current' : ''}" draggable="true" data-adapter-id="${esc(a.id)}">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                <div class="chip-title"><span>${esc(a.icon)}</span><span>${esc(a.name)}</span></div>
                <span class="status-badge"><span class="dot ${esc(a.status)}"></span>${esc(statusLabel(a.status))}</span>
              </div>
              <div style="font-size:11.5px;color:var(--fg-2)">${esc(a.summary)}</div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px">
                <span style="font-size:11px;color:var(--fg-3)">${esc(a.billing || '')}</span>
                ${isCurrent
                  ? '<span style="color:var(--ok);font-weight:700;font-size:11.5px">● 在岗</span>'
                  : `<button class="primary" style="padding:3px 9px" data-action="plug" data-slot="${esc(slot.id)}" data-adapter="${esc(a.id)}" ${state.busy ? 'disabled' : ''}>上岗</button>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  if (!state.hub) {
    root.innerHTML = '<div style="padding:20px;color:var(--fg-2)">正在连接多AI中枢…</div>';
    return;
  }

  const hub = state.hub;
  const canMsg = Boolean(state.hostCaps?.message);
  const canCtx = Boolean(state.hostCaps?.updateModelContext);

  if (state.activeTrackId) {
    const activeTrack = (hub.tracks || []).find((t) => t.id === state.activeTrackId);
    if (activeTrack) {
      root.innerHTML = renderTrackDetailPage(hub, activeTrack);
      bindDetailEvents(activeTrack);
      if (state.renamingTrackId === activeTrack.id) {
        const inp = document.getElementById('inline-rename-input');
        inp?.focus();
        inp?.select();
      }
      return;
    }
    state.activeTrackId = null;
  }

  const resultsCount = (hub.results || []).length;
  const activeJobs = hub.activeJobs || [];

  root.innerHTML = `
    <div class="page-stack">
      <div class="topbar">
        <div class="brand">
          <div class="brand-logo">🧩</div>
          <h1>多AI中枢</h1>
        </div>
        <div class="topbar-btns">
          ${canMsg ? `<button class="soft" id="btn-home-handover" ${state.busy ? 'disabled' : ''} title="一键把当前这条对话落盘换新并自动归档老对话">🔄 换新</button>` : ''}
          ${resultsCount > 0 ? `
            <button class="${state.openDrawer === 'results' ? 'active-pill' : 'text-btn'}" data-action="toggle-drawer" data-drawer="results" title="查看后台成品留档">
              成品 <span class="count-badge">${resultsCount}</span>
            </button>
          ` : ''}
          <button class="soft" id="btn-refresh" ${state.busy ? 'disabled' : ''} title="刷新">↻</button>
        </div>
      </div>

      ${state.attachedContextLabel ? `
        <div class="ctx-banner">
          <span>📎 已挂到左侧输入框：${esc(state.attachedContextLabel)}</span>
          <button class="text-btn" data-action="clear-ctx">取消</button>
        </div>
      ` : ''}

      ${state.lastSentNote ? `
        <div class="sent-card">
          <span>${esc(state.lastSentNote)}</span>
          <button class="text-btn" data-action="dismiss-sent">知道了</button>
        </div>
      ` : ''}

      ${renderReminders(hub)}

      ${renderTopDrawer(hub)}

      ${activeJobs.length > 0 ? activeJobs.map((j) => {
        const secs = Math.max(1, Math.round((Date.now() - (j.startedAtMs || Date.now())) / 1000));
        return `
          <div class="live-strip">
            <span>⏳ ${esc(j.adapterName)} 正在后台处理「${esc(j.title)}」（${secs}秒）</span>
            <span style="color:var(--fg-3)">完成后自动入库</span>
          </div>
        `;
      }).join('') : ''}

      <!-- 1. Mainlines Board -->
      <div class="section-block">
        <div class="sec-head">
          <div class="sec-title">当前主线</div>
          <button class="text-btn" data-action="toggle-drawer" data-drawer="add-track">+ 新建</button>
        </div>
        ${renderTracks(hub)}
      </div>

      <!-- 2. Fragment Memory Manager -->
      ${renderMemoriesSection(hub, canCtx)}

      <!-- 3. Collapsible Modular Team Config Bar -->
      <div class="section-block">
        <div class="sec-head">
          <div class="sec-title">${esc(hub.teamTitle || '班子配置')}</div>
        </div>
        <div class="team-accordion">
          <div class="team-bar" id="btn-toggle-team">
            <div class="team-summary-chips">
              ${hub.slots.map((s) => `
                <span class="mini-chip">
                  <span class="dot ${s.mounted ? esc(s.mounted.status) : 'empty'}"></span>
                  <span>${esc(s.label)}：<strong>${s.mounted ? esc(s.mounted.name) : '空'}</strong></span>
                </span>
              `).join('')}
            </div>
            <span style="font-size:11.5px;color:var(--fg-3)">${state.teamExpanded ? '收起 ▴' : '拔插 ▾'}</span>
          </div>
          ${state.teamExpanded ? `
            <div class="team-body">
              <div class="slots-row">
                ${hub.slots.map((s) => {
                  const m = s.mounted;
                  const isPicking = state.pickingSlotId === s.id;
                  return `
                    <div class="slot-card ${isPicking ? 'picking' : ''}" data-slot-id="${esc(s.id)}">
                      <div class="slot-top">
                        <div class="slot-name">${esc(s.label)}</div>
                        <span class="status-badge">
                          <span class="dot ${m ? esc(m.status) : 'empty'}"></span>
                          ${m ? esc(statusLabel(m.status)) : '空位'}
                        </span>
                      </div>
                      ${m ? `
                        <div class="slot-chip">
                          <div class="chip-title"><span>${esc(m.icon)}</span><span>${esc(m.name)}</span></div>
                          <div class="chip-desc">${esc(m.billing || m.vendor)}</div>
                        </div>
                      ` : `
                        <div class="slot-chip empty">未插人</div>
                      `}
                      <div class="slot-btns">
                        <button data-action="pick-slot" data-slot="${esc(s.id)}">
                          ${isPicking ? '收起' : (m ? '换人' : '插一个')}
                        </button>
                        ${m ? `<button class="ghost-danger" data-action="unplug" data-slot="${esc(s.id)}" ${state.busy ? 'disabled' : ''}>拔出</button>` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
              ${renderPickerDrawer(hub)}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  bindEvents();
  if (state.renamingTrackId) {
    const inp = document.getElementById('inline-rename-input');
    inp?.focus();
    inp?.select();
  }
}

function bindPriorityPickers() {
  document.querySelectorAll('[data-stop-row]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
  });
  document.querySelectorAll('[data-action="change-priority"]').forEach((sel) => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      changeTrackPriority(sel.dataset.trackId, e.target.value, sel.dataset.title);
    });
  });
}

function bindCommonRenameEvents() {
  const inp = document.getElementById('inline-rename-input');
  inp?.addEventListener('input', (e) => {
    state.renameDraft = e.target.value;
  });
  inp?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.renamingTrackId) commitInlineRename(state.renamingTrackId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.renamingTrackId = null;
      state.renameDraft = '';
      render();
    }
  });
  document.querySelector('[data-action="save-rename"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = e.currentTarget.dataset.trackId;
    if (id) commitInlineRename(id);
  });
  document.querySelector('[data-action="cancel-rename"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.renamingTrackId = null;
    state.renameDraft = '';
    render();
  });
}

function bindEvents() {
  document.querySelector('[data-action="dismiss-sent"]')?.addEventListener('click', () => {
    state.lastSentNote = '';
    render();
  });
  document.querySelector('[data-action="clear-ctx"]')?.addEventListener('click', clearAttachedContext);

  const memInput = document.getElementById('mem-quick-input');
  memInput?.addEventListener('input', (e) => {
    state.memoryInputText = e.target.value;
  });
  memInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addMemoryItem();
    }
  });
  document.getElementById('btn-add-memory')?.addEventListener('click', addMemoryItem);
  document.getElementById('btn-tidy-memories')?.addEventListener('click', tidyMemoriesWithWorker);
  document.getElementById('btn-toggle-done-mem')?.addEventListener('click', () => {
    state.showDoneMemories = !state.showDoneMemories;
    render();
  });
  document.getElementById('btn-toggle-vault')?.addEventListener('click', () => {
    state.showVault = !state.showVault;
    render();
  });
  document.getElementById('btn-open-vault')?.addEventListener('click', openLocalVaultFolder);
  document.getElementById('vault-search-input')?.addEventListener('input', (e) => {
    state.vaultSearch = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = document.getElementById('vault-search-input');
    if (inp) {
      inp.focus();
      if (pos !== null) inp.setSelectionRange(pos, pos);
    }
  });
  document.querySelectorAll('[data-action="promote-mem"]').forEach((btn) => {
    btn.addEventListener('click', () => promoteMemoryItem(btn.dataset.memId));
  });
  document.querySelectorAll('[data-action="delete-vault"]').forEach((btn) => {
    btn.addEventListener('click', () => removeVaultItem(btn.dataset.vaultId));
  });
  document.querySelectorAll('[data-action="copy-vault"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const txt = btn.dataset.text || '';
      try {
        await navigator.clipboard?.writeText(txt);
        showToast('📋 已复制到剪贴板');
      } catch {
        showToast(txt);
      }
    });
  });
  document.querySelectorAll('[data-action="apply-tidy"]').forEach((btn) => {
    btn.addEventListener('click', () => applyTidyProposal(btn.dataset.accept === '1'));
  });
  document.querySelectorAll('[data-action="rem-done-mem"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleMemoryItem(btn.dataset.memId, true));
  });
  document.querySelectorAll('[data-action="toggle-mem"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleMemoryItem(btn.dataset.memId));
  });
  document.querySelectorAll('[data-action="delete-mem"]').forEach((btn) => {
    btn.addEventListener('click', () => removeMemoryItem(btn.dataset.memId));
  });
  document.querySelectorAll('[data-action="attach-mem"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = (state.hub?.memories || []).find((x) => x.id === btn.dataset.memId);
      if (!m) return;
      const ctxText = `【来自多AI记忆总管的碎片记忆】\n内容：${m.text}${m.dueDate ? `\n到期日：${m.dueDate}` : ''}${m.tag ? `\n分类：${m.tag}` : ''}`;
      attachToNextMessage(m.text.slice(0, 22), ctxText);
    });
  });

  document.getElementById('btn-refresh')?.addEventListener('click', refreshStatus);
  document.getElementById('btn-home-handover')?.addEventListener('click', handoverCurrentChat);

  document.querySelectorAll('[data-action="toggle-drawer"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.drawer;
      state.openDrawer = state.openDrawer === target ? null : target;
      render();
    });
  });
  document.querySelector('[data-action="close-drawer"]')?.addEventListener('click', () => {
    state.openDrawer = null;
    render();
  });

  document.querySelectorAll('[data-action="pick-slot"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.slot;
      state.pickingSlotId = state.pickingSlotId === id ? null : id;
      render();
    });
  });
  document.querySelector('[data-action="close-picker"]')?.addEventListener('click', () => {
    state.pickingSlotId = null;
    render();
  });
  document.querySelectorAll('[data-action="unplug"]').forEach((btn) => {
    btn.addEventListener('click', () => swapSlot(btn.dataset.slot, 'none'));
  });
  document.querySelectorAll('[data-action="plug"]').forEach((btn) => {
    btn.addEventListener('click', () => swapSlot(btn.dataset.slot, btn.dataset.adapter));
  });

  document.querySelectorAll('.candidate-card[draggable="true"]').forEach((chip) => {
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', chip.dataset.adapterId || '');
    });
  });
  document.querySelectorAll('.slot-card').forEach((card) => {
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const adapterId = e.dataTransfer?.getData('text/plain');
      const slotId = card.dataset.slotId;
      if (adapterId && slotId) swapSlot(slotId, adapterId);
    });
  });

  document.querySelectorAll('[data-action="open-result"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleResultReply(btn.dataset.id, btn.dataset.file, btn.dataset.rel));
  });

  document.getElementById('btn-save-track')?.addEventListener('click', addTrack);

  document.getElementById('btn-toggle-team')?.addEventListener('click', () => {
    state.teamExpanded = !state.teamExpanded;
    if (!state.teamExpanded) state.pickingSlotId = null;
    render();
  });

  document.querySelectorAll('[data-action="start-rename"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.confirmDeleteTrackId = null;
      state.renamingTrackId = btn.dataset.trackId;
      state.renameDraft = btn.dataset.title || '';
      render();
    });
  });
  document.querySelectorAll('[data-action="delete-track"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestDeleteTrack(btn.dataset.trackId, btn.dataset.title);
    });
  });
  bindCommonRenameEvents();
  bindPriorityPickers();

  document.querySelectorAll('[data-action="open-track"]').forEach((row) => {
    row.addEventListener('click', () => {
      state.activeTrackId = row.dataset.trackId;
      state.trackShowBg = false;
      state.trackEditMeta = false;
      state.renamingTrackId = null;
      state.confirmDeleteTrackId = null;
      state.lastSentNote = '';
      render();
    });
  });
}

function bindDetailEvents(track) {
  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    state.activeTrackId = null;
    state.trackShowBg = false;
    state.trackEditMeta = false;
    state.renamingTrackId = null;
    state.confirmDeleteTrackId = null;
    state.lastSentNote = '';
    render();
  });
  document.getElementById('btn-detail-delete')?.addEventListener('click', () => requestDeleteTrack(track.id, track.title));
  document.getElementById('btn-toggle-bg')?.addEventListener('click', () => {
    state.trackShowBg = !state.trackShowBg;
    render();
  });
  document.getElementById('btn-toggle-edit')?.addEventListener('click', () => {
    state.trackEditMeta = !state.trackEditMeta;
    render();
  });
  document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
    state.trackEditMeta = false;
    render();
  });
  document.getElementById('btn-save-meta')?.addEventListener('click', () => saveTrackMeta(track.id));

  const startHeroRename = () => {
    state.renamingTrackId = track.id;
    state.renameDraft = track.title || '';
    render();
  };
  document.getElementById('btn-hero-rename')?.addEventListener('click', startHeroRename);
  document.getElementById('btn-hero-rename-icon')?.addEventListener('click', startHeroRename);
  bindCommonRenameEvents();
  bindPriorityPickers();

  document.getElementById('chk-archive-old')?.addEventListener('change', (e) => {
    state.archiveOldOnNew = Boolean(e.target.checked);
  });
  document.getElementById('btn-attach-track')?.addEventListener('click', () => {
    const ctxText = [
      `【来自多AI记忆总管的主线背景】`,
      `主线：${track.priority} · ${track.title}`,
      track.goal ? `目标：${track.goal}` : '',
      track.latest ? `最新进度：${track.latest}` : '',
      track.next ? `下一步：${track.next}` : '',
      (track.keyFiles && track.keyFiles.length) ? `关联文件：${track.keyFiles.join('、')}` : '',
    ].filter(Boolean).join('\n');
    attachToNextMessage(`${track.priority} · ${track.title}`, ctxText);
  });
  document.querySelector('[data-action="clear-ctx"]')?.addEventListener('click', clearAttachedContext);
  document.getElementById('btn-track-new')?.addEventListener('click', () => openTrackNewConversation(track));
  const workerInput = document.getElementById('track-worker-input');
  workerInput?.addEventListener('input', (e) => {
    state.trackInputText = e.target.value;
  });
  workerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dispatchTrackWorker(track);
    }
  });
  document.getElementById('btn-track-worker')?.addEventListener('click', () => dispatchTrackWorker(track));
  document.querySelector('[data-action="dismiss-sent"]')?.addEventListener('click', () => {
    state.lastSentNote = '';
    render();
  });

  document.querySelectorAll('[data-action="copy-path"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = btn.dataset.path || '';
      try {
        await navigator.clipboard?.writeText(p);
        showToast(`📋 已复制路径：${p}`);
      } catch {
        showToast(p);
      }
    });
  });
  document.querySelectorAll('[data-action="open-result"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleResultReply(btn.dataset.id, btn.dataset.file, btn.dataset.rel));
  });
}

app.ontoolresult = (result) => {
  if (result?.structuredContent?.slots) {
    state.hub = result.structuredContent;
    syncPolling();
    render();
  } else if (result?.structuredContent?.status?.slots) {
    state.hub = result.structuredContent.status;
    syncPolling();
    render();
  }
};

app.onhostcontextchanged = (ctx) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

async function boot() {
  try {
    await app.connect();
    state.hostCaps = app.getHostCapabilities() || {};
    const ctx = app.getHostContext();
    if (ctx?.theme) applyDocumentTheme(ctx.theme);
    if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (!state.hub) {
      await refreshStatus();
    }
  } catch (e) {
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `<div style="padding:16px">连接失败：${esc(e.message)}</div>`;
    }
  }
}

boot();
