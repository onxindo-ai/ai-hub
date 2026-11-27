#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  getHubPaths,
  getStatus,
  setSlot,
  dispatchTask,
  dispatchTaskAsync,
  recordReview,
  recordResult,
  addCustomTrack,
  updateTrackMeta,
  deleteTrack,
  bindTrackConversation,
  updateBriefing,
  addInboxItem,
  replyBridgeRequest,
  readRuntimeFile,
  handoverConversation,
} from './hub-ctl.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URI = 'ui://ai-hub/panel.html';
const SERVER_INFO = { name: 'ai-hub-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

const PANE_META = {
  ui: { resourceUri: APP_URI },
  'com.google.antigravity/ui': {
    entrypoints: [
      { type: 'aux_pane', title: '多AI中枢' },
      { type: 'global', title: '多AI中枢' },
    ],
  },
};

const TOOLS = [
  {
    name: 'open_ai_hub',
    title: '多AI中枢面板',
    description: '打开模块化多 AI 中枢可视化面板：查看与热插拔拔插 AI 角色卡槽（DeepSeek / Codex / Claude / Gemini / 手机秘书）、查看任务单与交付件、刷新进度简报或触发一键无感换新对话。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    _meta: PANE_META,
  },
  {
    name: 'hub_status',
    title: '获取中枢实时状态',
    description: '获取所有卡槽挂载状态、本机各 AI 模块可用性检测、最近任务单/交付件/审核单与进度简报。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_set_slot',
    title: '热插拔 AI 卡槽模块',
    description: '像拔插积木一样将某个 AI 模块插入指定卡槽（orchestrator / worker / reviewer / secretary），或传入 "none" 拔出模块，整条链路即时生效。',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: '卡槽 ID: orchestrator | worker | reviewer | secretary' },
        adapterId: { type: 'string', description: '模块 ID（如 deepseek-dsh / codex-cli / claude-cli / gemini-cli / native-subagent / grok-bot / none）' },
      },
      required: ['slotId', 'adapterId'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_dispatch_task',
    title: '自动派发任务到指定卡槽',
    description: '零人工传话：自动生成任务单并调用当前挂载在指定卡槽（默认 worker）的无头 AI 模块执行，结果落盘到 runtime/交付件/，仅返回精简摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '简短任务标题' },
        prompt: { type: 'string', description: '完整任务说明与输出格式要求' },
        slot: { type: 'string', description: '目标卡槽（默认 worker）' },
        mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: '权限模式（默认 read-only）' },
        noWeb: { type: 'boolean', description: '是否禁止联网搜索（默认 true）' },
        timeout: { type: 'number', description: '超时秒数（默认 180）' },
        trackId: { type: 'string', description: '关联的主线任务 ID（可选）' },
        async: { type: 'boolean', description: '是否后台异步执行（面板调用建议 true，立即返回避免 60s 超时）' },
      },
      required: ['title', 'prompt'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_update_briefing',
    title: '刷新远程秘书进度简报',
    description: '更新 runtime/进度简报.md，供手机端 Grok Bot 或任意替代机器人实时读取汇报。',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: '最新进度 Markdown 内容' },
      },
      required: ['markdown'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_add_inbox',
    title: '写入手机指令箱',
    description: '向 runtime/手机指令箱.md 追加一条远程待办指令。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '指令内容' },
        source: { type: 'string', description: '来源标注（默认 panel）' },
      },
      required: ['text'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_record_review',
    title: '记录独立审核结论',
    description: '将子代理或审校槽的验收结论写入 runtime/审核单/。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        verdict: { type: 'string', enum: ['PASS', 'REVISE', 'REJECT'] },
        summary: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['taskId', 'verdict', 'summary'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_handover_conversation',
    title: '一键落盘并创建接力新对话',
    description: '生成交接单；在 Antigravity 中自动创建已发送热身词的新对话并归档当前旧对话，否则返回可复制交接词。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '新对话标题' },
        summary: { type: 'string', description: '当前阶段总结' },
        files: { type: 'string', description: '逗号分隔的必读文件列表' },
        nextSteps: { type: 'string', description: '下一步具体动作' },
        model: { type: 'string', description: '新对话模型档位（默认 pro）' },
        trackId: { type: 'string', description: '关联主线 ID（用于记录并精准归档本主线旧对话）' },
        archiveCurrent: { type: 'boolean', description: '是否自动归档旧对话（默认 true）' },
        dryRun: { type: 'boolean', description: '仅演练不创建新对话' },
      },
      required: ['title', 'summary', 'nextSteps'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_record_result',
    title: '登记成品结果与关键文件路径',
    description: '把最终成品标题、1-2 句结论和关键文件路径登记到面板底部，方便用户一键打开查看，不展示中间过程文件。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '成品中文标题' },
        summary: { type: 'string', description: '1-2 句人话结论' },
        files: { type: 'array', items: { type: 'string' }, description: '关键成品文件路径列表' },
        by: { type: 'string', description: '完成角色（默认 主力）' },
      },
      required: ['title', 'summary'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_add_track',
    title: '新增主线任务（仅面板）',
    description: '在本地主线任务列表中新增一条待跟进主线。',
    inputSchema: {
      type: 'object',
      properties: {
        priority: { type: 'string' },
        title: { type: 'string' },
        goal: { type: 'string' },
        status: { type: 'string' },
        next: { type: 'string' },
      },
      required: ['title'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'hub_update_track_meta',
    title: '更新主线标题、目标与最新进度（仅面板）',
    description: '重命名主线标题，或更新某条主线的优先级、最终目标、最新进度或下一步行动。',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        title: { type: 'string' },
        priority: { type: 'string' },
        goal: { type: 'string' },
        latest: { type: 'string' },
        next: { type: 'string' },
      },
      required: ['trackId'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'hub_delete_track',
    title: '删除或隐藏主线（仅面板）',
    description: '删除自定义主线，或隐藏总表同步过来的主线。',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
      },
      required: ['trackId'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'hub_bind_track_conversation',
    title: '绑定主线新对话并可选归档本主线旧对话（仅面板）',
    description: '记录某条主线的最新对话 ID；若 archivePrevious 为 true，精准归档该主线上一条旧对话。',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        conversationId: { type: 'string' },
        archivePrevious: { type: 'boolean' },
      },
      required: ['trackId', 'conversationId'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'hub_reply_bridge',
    title: '回传结果给手机秘书（远程接力）',
    description: '当主力处理完由手机秘书转交的远程任务后，调用此工具把大白话结论原路回传给手机秘书，回复用户手机。',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: '任务开头标注的请求单号（例如 REQ-20261126-...）' },
        reply: { type: 'string', description: '发回给用户手机的大白话结论（简明直白、无专业术语）' },
      },
      required: ['requestId', 'reply'],
    },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'hub_read_runtime_file',
    title: '读取运行态文件（仅面板）',
    description: '仅供面板前端预览任务单、交付件、审核单或交接单全文，不占用模型上下文。',
    inputSchema: {
      type: 'object',
      properties: {
        relPath: { type: 'string', description: '相对于 runtime/ 的文件路径' },
      },
      required: ['relPath'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
];

function formatStatusText(st) {
  const lines = [
    `多 AI 模块化中枢状态（${st.updatedAt}）：`,
    ...st.slots.map((s) => {
      const m = s.mounted;
      const badge = !m ? '空槽' : (m.status === 'ready' ? '就绪' : m.statusDetail);
      return `- ${s.label} [${s.id}]: ${m ? `${m.icon} ${m.name} (${m.id})` : '未插模块'} — ${badge}`;
    }),
  ];
  return lines.join('\n');
}

function readPanelHtml() {
  const { hubRoot } = getHubPaths();
  const htmlPath = process.env.AI_HUB_PANEL_HTML || path.join(hubRoot, 'ui', 'panel.html');
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf8');
  }
  return '<!doctype html><html><body><h3>panel.html not built yet</h3></body></html>';
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function okResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function errResult(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleToolCall(name, args = {}) {
  try {
    if (name === 'open_ai_hub' || name === 'hub_status') {
      const st = getStatus();
      return {
        content: [{ type: 'text', text: formatStatusText(st) }],
        structuredContent: st,
      };
    }
    if (name === 'hub_set_slot') {
      const res = setSlot(args.slotId, args.adapterId);
      const st = getStatus();
      return {
        content: [{ type: 'text', text: res.message }],
        structuredContent: { action: res, status: st },
      };
    }
    if (name === 'hub_dispatch_task') {
      if (args.async) {
        const res = dispatchTaskAsync({
          title: args.title,
          prompt: args.prompt,
          slot: args.slot || 'worker',
          mode: args.mode || 'read-only',
          noWeb: args.noWeb !== false,
          timeout: args.timeout || 180,
          trackId: args.trackId || null,
        });
        const st = getStatus();
        return {
          content: [{ type: 'text', text: `已后台启动任务：${res.job.title}（${res.job.adapterName}）` }],
          structuredContent: { result: res, status: st },
        };
      }
      const res = dispatchTask({
        title: args.title,
        prompt: args.prompt,
        slot: args.slot || 'worker',
        mode: args.mode || 'read-only',
        noWeb: args.noWeb !== false,
        timeout: args.timeout || 180,
        trackId: args.trackId || null,
      });
      const st = getStatus();
      return {
        isError: !res.ok,
        content: [{
          type: 'text',
          text: res.ok
            ? `任务 ${res.taskId} 已由 ${res.adapterName} 完成（${(res.durationMs / 1000).toFixed(1)}s），交付件：${res.deliveryRelPath}\n\n摘要：\n${res.preview}`
            : `任务 ${res.taskId} 执行失败：${res.errorSummary}`,
        }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_update_briefing') {
      const res = updateBriefing(args.markdown || '');
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已刷新进度简报 (${res.updatedAt})` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_add_inbox') {
      const res = addInboxItem(args.text || '', args.source || 'panel');
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已追加手机指令：${res.added}` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_record_review') {
      const res = recordReview(args);
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已记录审核单：${res.relPath}（${args.verdict}）` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_handover_conversation') {
      const res = await handoverConversation({
        title: args.title,
        summary: args.summary,
        files: args.files,
        nextSteps: args.nextSteps,
        model: args.model,
        trackId: args.trackId || null,
        archiveCurrent: args.archiveCurrent !== false,
        dryRun: Boolean(args.dryRun),
      });
      const st = getStatus();
      return {
        isError: !res.ok,
        content: [{
          type: 'text',
          text: res.link
            ? `已自动创建接棒新对话并落盘交接单：${res.link}`
            : `已落盘交接单 (${res.handoverRel})，请复制开场词或点面板一键发起新对话。`,
        }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_record_result') {
      const res = recordResult(args);
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已登记成品结果：${res.item.title}` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_add_track') {
      const res = addCustomTrack(args);
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已新增主线：${res.item.title}` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_update_track_meta') {
      const res = updateTrackMeta(args);
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已更新主线目标与进度` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_delete_track') {
      const res = deleteTrack(args.trackId);
      const st = getStatus();
      return {
        content: [{ type: 'text', text: `已删除主线` }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_bind_track_conversation') {
      const res = await bindTrackConversation({
        trackId: args.trackId,
        conversationId: args.conversationId,
        archivePrevious: Boolean(args.archivePrevious),
      });
      const st = getStatus();
      return {
        content: [{ type: 'text', text: res.archivedPreviousId ? '已绑定新对话并归档本主线旧对话' : '已绑定主线新对话' }],
        structuredContent: { result: res, status: st },
      };
    }
    if (name === 'hub_reply_bridge') {
      const res = replyBridgeRequest({
        requestId: args.requestId,
        reply: args.reply,
      });
      return {
        content: [{ type: 'text', text: `✅ 已将大白话结论回传给手机秘书（单号 ${res.requestId}）` }],
        structuredContent: res,
      };
    }
    if (name === 'hub_read_runtime_file') {
      const file = readRuntimeFile(args.relPath);
      return {
        content: [{ type: 'text', text: file.content }],
        structuredContent: file,
      };
    }
    return {
      isError: true,
      content: [{ type: 'text', text: `未知工具: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `执行出错: ${err.message}` }],
      structuredContent: { ok: false, error: err.message },
    };
  }
}

async function handleRequest(req) {
  const { id, method, params } = req;
  // Notifications have no id
  if (id === undefined || id === null) {
    return;
  }

  try {
    if (method === 'initialize') {
      return okResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === 'ping') {
      return okResult(id, {});
    }
    if (method === 'tools/list') {
      return okResult(id, { tools: TOOLS });
    }
    if (method === 'tools/call') {
      const result = await handleToolCall(params?.name, params?.arguments || {});
      return okResult(id, result);
    }
    if (method === 'resources/list') {
      return okResult(id, {
        resources: [
          {
            uri: APP_URI,
            name: '多AI中枢可视化插槽面板',
            description: '可视化拔插 AI 模块卡槽、查看任务交付件与审核单、一键换新对话',
            mimeType: 'text/html;profile=mcp-app',
            _meta: { ui: { prefersBorder: false } },
          },
        ],
      });
    }
    if (method === 'resources/read') {
      if (params?.uri !== APP_URI) {
        return errResult(id, -32602, `Unknown resource URI: ${params?.uri}`);
      }
      return okResult(id, {
        contents: [
          {
            uri: APP_URI,
            mimeType: 'text/html;profile=mcp-app',
            text: readPanelHtml(),
            _meta: { ui: { prefersBorder: false } },
          },
        ],
      });
    }
    return errResult(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    return errResult(id, -32603, err.message || 'Internal error');
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  handleRequest(req);
});
