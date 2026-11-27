# 多AI中枢（AI Hub · 模块化本地协作底座）

> **做减法、新手也能 3 分钟跑通的多 AI 协同底座。**  
> **先用上，你才知道自己真正需要什么；自己调出来的工具，用着才不烧心。**

---

## 🤖 新手 / 懒人一键上手（直接发给你的 AI 看）

不想看文档？直接把下面这段话复制发给你正在用的 AI（Antigravity / Claude / Gemini / Codex 均可），让它**一键读完并用大白话手把手帮你装好**：

```text
请读取这个仓库里的 docs/AI_GUIDE.md，先用大白话用 5 句话告诉我这个工具怎么用、能帮我干什么；然后帮我检查电脑环境，按我的需要把它装好并配置好我的主力 AI 和辅助 AI。
```

---

## 📚 配套使用说明（给人看 & 给 AI 读）

- 🤖 **[docs/AI_GUIDE.md](docs/AI_GUIDE.md)** — **专门写给 AI 读的导游手册**：让任何 AI 一键读懂本仓库，并自动翻译成大白话教用户安装、配槽位与排障。
- 🐣 **[docs/QUICKSTART_新手大白话指南.md](docs/QUICKSTART_新手大白话指南.md)** — **零术语 3 分钟大白话指南**：给刚接触多 AI 协同的新手直接看。
- 🛠️ **[docs/CUSTOMIZE_让AI帮你魔改指南.md](docs/CUSTOMIZE_让AI帮你魔改指南.md)** — **按需加挂件手册**：附带可直接发给 AI 的改造口令（改岗位名、换模型、改全自动/人工审校、调 Mac 面板样式）。

---

## 一、为什么自己造这个轮子？

市面上很多成品多 AI Skill 功能不是少，而是**太多、太杂**，都是重度玩家按自己的复杂动作流搭出来的，新手根本用不上。

这个项目的思路就是 **做减法 + 模块化**：
1. **底层原理极简**：所有 AI 共读你本地工作区里的同一份文件（纯 Markdown，不锁死任何厂商、不靠脆弱云端桥接）；
2. **4 个岗位像换电池一样热插拔**：今天哪个 AI 强、哪个便宜，直接把旧模块抽出来插个新的进去，流程不断；
3. **默认半自动人工把关**：避免某些模型突发「豆化」跑偏，关键结论自己看一眼再放行（当然你随时可以让 AI 改成全自动）；
4. **按主线任务分区 + 一键交接换新对话**：上下文快聊满了点一下「一键交接」，自动落盘交接单并开启干净新对话，不用重新交代背景。

---

## 二、四个可热插拔岗位（日常前 3 个就够用）

| 岗位 | 槽位 ID | 默认上岗 | 干什么（好钢用在刀刃上） |
| :--- | :--- | :--- | :--- |
| **主力** | `orchestrator` | 当前主力 AI | 唯一跟你对话的入口：沟通、定方案、拍板交付（换 Antigravity / Claude / Codex 无缝接管）。 |
| **黑奴** | `worker` | DeepSeek CLI | **专干消耗额度大、不费脑子的体力活**（批量扫文件、洗日志、抽表格），把贵额度省给主力。随时可换 Codex / Claude / Gemini。 |
| **监工 / 主力辅助** | `reviewer` | 主力分身 | 独立干净上下文负责深度思考、分工与结果把关，极大延长主力对话的上下文寿命。 |
| **秘书** | `secretary` | 手机秘书 (Grok) | 出门在外用手机看简报、替你传话应急；**平时大部分时候用不到，随时可拔掉**。 |

---

## 三、3 秒一键安装

前置要求：本机安装 **Node.js 18+**，按需安装你想插进槽位的 AI CLI（如 DeepSeek、Codex、Claude、Gemini 等）。

```bash
git clone https://github.com/onxindo-ai/ai-hub.git ai-hub
cd ai-hub
chmod +x install.sh
./install.sh                     # 安装 Antigravity 插件与一屏可视化面板
# 或同时挂载到你的工作区目录，供 Claude / Codex / Gemini 等读取：
./install.sh /path/to/your-workspace
```

### 可选：顺手编一个 Mac 原生极简桌面面板
平时藏在屏幕顶部，鼠标碰一下就滑下来；拖离顶部变悬浮窗（需要 macOS 13+ 与 Xcode Command Line Tools）：

```bash
chmod +x macos/build-app.sh
./macos/build-app.sh
open "macos/多AI中枢.app"
```

---

## 四、命令行热插拔（任意终端 / 任意 AI 通用）

```bash
node bin/hub-ctl.mjs status                       # 查看当前 4 个岗位状态
node bin/hub-ctl.mjs slot set worker codex-cli    # 把黑奴换成 Codex
node bin/hub-ctl.mjs slot set worker deepseek-dsh # 换回 DeepSeek
node bin/hub-ctl.mjs slot set secretary none      # 拔掉不需要的秘书岗位
```

想扩展自定义 AI CLI？复制 `adapters/custom-cli.example.json` 改名为 `adapters/<名字>.json` 填入命令模板即可被面板自动识别。

---

## 五、开源与隐私说明

`.gitignore` 已默认排除 `runtime/`、`config/slots.json`、`*.env`、`macos/*.app/` 与 `ui-src/node_modules/`，你的个人工作记录、密钥和本地配置永远不会随仓库同步泄露；`ui/panel.html` 已预编译为单文件，克隆后无需 `npm install` 即可直接运行。
