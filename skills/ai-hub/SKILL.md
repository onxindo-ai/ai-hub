---
name: ai-hub
description: 模块化多 AI 指挥中枢（主力·黑奴·监工·秘书 4 岗位热插拔、零人工传话派工、监工独立验收、只呈成品结果、一键无感换新对话）。在需要派发批量体力任务、切换/拔插 AI 模块、刷新秘书简报、或上下文过长一键无感换新对话时使用。
---

# 多 AI 模块化指挥中枢（主力 · 黑奴 · 监工 · 秘书）

本技能让**任何主力 AI**（Antigravity、Claude、Codex）都能以统一协议调度 4 个可热插拔岗位：**只认岗位、不绑死厂商；零人工传话；中间过程走文件不糊用户一脸；只向用户呈现最终成品与关键路径**。

## 一、四大可热插拔岗位

| 岗位名 | 内部槽位 ID | 默认上岗 | 职责与铁律 |
| :--- | :--- | :--- | :--- |
| **主力** | `orchestrator` | 当前主力 AI | 唯一跟用户对话的入口：沟通、动脑子定方案、高难推理排障、最终交付。 |
| **黑奴** | `worker` | `deepseek-dsh` | **只干低智商高体力/大上下文的活**（批量扫几十份文件、洗日志、按模板抽表格）。**严禁把考验智商的架构/复杂推理派给便宜模型，防止返工拖慢效率！** |
| **监工** | `reviewer` | `native-subagent` | 在独立干净上下文验收黑奴的产出，过关了才把精炼结论报给主力（可热插拔换 `codex-cli` / `claude-cli`）。 |
| **秘书** | `secretary` | `grok-bot` | 出门在外用手机读 `runtime/进度简报.md` 汇报进度、向 `runtime/手机指令箱.md` 记口头交代；随时可拔掉停费，不影响主体系。 |

## 二、记忆总管（临时碎片 + 本地重要记录本自动分流）

1. **聊天框随口记**：只要用户在任意对话里说「帮我记一下 / 别忘了 / 提醒我 xxx」，主力 AI 立即调用 `hub_add_memory`（或 `node "<HUB_ROOT>/bin/hub-ctl.mjs" memory add "..."`）：
   - 含账号、密码、Apple ID、长期重要信息的内容会**自动分流永久存入本机 `runtime/重要记录/账号与重要记录本.md`**（不进临时碎片清理、不外发给第三方模型）；
   - 普通临时事项则记入碎片列表（自动识别日期并同步到 `runtime/记忆总管.md`），干完可随手划掉或删除。
2. **新对话接手速览**：接手对话时顺手读取 `runtime/记忆总管.md`（或调用 `hub_list_memories`），主动提醒用户今天到期或超期未跟进的事项；仅当用户主动查找账号/重要记录时再调 `hub_list_vault` 检索。

## 三、全自动协作流（零人工传话）

1. **动脑子的活 / 联网核查**：主力自己做，或开主力分身子代理隔离完成。
2. **批量体力活**：主力直接调命令派给当前在岗的「黑奴」：
   ```bash
   node "<HUB_ROOT>/bin/hub-ctl.mjs" dispatch \
     --slot worker \
     --title "<中文任务名>" \
     --mode read-only \
     --no-web \
     --prompt "<完整任务说明与输出格式>"
   ```
3. **监工独立验收**：主力开干净子代理读黑奴交付件验收，只把精炼结论带回主对话给用户，不把中间流水文件摊给用户看。
4. **登记关键成品**：交付重要文档或成果文件时，登记到面板底部的「成品结果与关键文件」（调用 `hub_record_result` 或 `hub-ctl.mjs result`），让用户一眼看到结论和文件路径。
5. **收尾刷新秘书简报**：调 `brief update` 更新 `runtime/进度简报.md`。

## 三、热插拔换人（命令行与面板同步）

```bash
# 查看当前 4 个岗位状态
node "<HUB_ROOT>/bin/hub-ctl.mjs" status

# 把黑奴从 DeepSeek 换成 Codex（整条链路 0 改动）
node "<HUB_ROOT>/bin/hub-ctl.mjs" slot set worker codex-cli

# 换回 DeepSeek
node "<HUB_ROOT>/bin/hub-ctl.mjs" slot set worker deepseek-dsh

# 拔掉秘书槽（不续费 Grok 时）
node "<HUB_ROOT>/bin/hub-ctl.mjs" slot set secretary none
```

## 四、一键无感换新对话

当上下文较长（累计调用 ≥ 35–40 次 / 大文件 ≥ 6–8 份 / 深度问答 ≥ 20 轮 / 较长对话大阶段收尾）或用户要求换新时：

```bash
node "<HUB_ROOT>/bin/hub-ctl.mjs" handover \
  --title "<续接主题>" \
  --summary "<2-3句阶段总结>" \
  --files "事情总表.md,<关键文件>" \
  --next "<下一步动作>"
```

在 Antigravity 中自动落盘 + 自动创建已热身的新对话 + 自动归档旧对话，返回一键直达链接给用户；在其他客户端中自动输出可复制交接词。

## 五、安全红线
- 严禁打印、外传或提交 `.env` / 密钥 / `runtime/` 到 GitHub；
- 未经用户许可，黑奴默认 `--mode read-only`，严禁触碰 `*.sqlite3`、`.env` 与生产环境写入。
