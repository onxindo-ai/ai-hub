#!/usr/bin/env bash
set -euo pipefail

# 多AI中枢 · Modular AI Hub 一键部署脚本
# 用法：
#   ./install.sh                         # 在当前目录部署（挂 Antigravity 插件 + 初始化配置）
#   ./install.sh /path/to/workspace      # 同时挂载到指定工作区的 技能/ 与 .agents/skills/

HUB_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="${1:-}"
AGY_PLUGINS_DIR="${HOME}/.gemini/config/plugins"
PLUGIN_LINK="${AGY_PLUGINS_DIR}/ai-hub"

echo "=== 1. 初始化多AI中枢目录与权限 ==="
chmod +x "${HUB_DIR}/bin/hub-ctl.mjs" "${HUB_DIR}/bin/mcp-server.mjs"
node "${HUB_DIR}/bin/hub-ctl.mjs" status >/dev/null

echo "=== 2. 安装 Antigravity 原生插件与可视化面板 ==="
mkdir -p "${AGY_PLUGINS_DIR}"
if [ -L "${PLUGIN_LINK}" ]; then
  rm "${PLUGIN_LINK}"
elif [ -e "${PLUGIN_LINK}" ]; then
  echo "检测到已存在的非软链目录 ${PLUGIN_LINK}，已自动备份至 ${PLUGIN_LINK}.bak-$(date +%Y%m%d%H%M%S)"
  mv "${PLUGIN_LINK}" "${PLUGIN_LINK}.bak-$(date +%Y%m%d%H%M%S)"
fi
ln -s "${HUB_DIR}" "${PLUGIN_LINK}"
echo "✅ Antigravity 插件已链接: ${PLUGIN_LINK} -> ${HUB_DIR}"

if [ -n "${WORKSPACE_DIR}" ] && [ -d "${WORKSPACE_DIR}" ]; then
  echo "=== 3. 同步 Skill 到工作区（兼容 Claude / Codex / 其他 Agent）==="
  if [ -d "${WORKSPACE_DIR}/技能" ]; then
    mkdir -p "${WORKSPACE_DIR}/技能/多AI中枢"
    ln -sf "${HUB_DIR}/skills/ai-hub/SKILL.md" "${WORKSPACE_DIR}/技能/多AI中枢/SKILL.md"
    echo "✅ 已链接工作区技能: ${WORKSPACE_DIR}/技能/多AI中枢/SKILL.md"
  fi
  if [ -d "${WORKSPACE_DIR}/.agents/skills" ]; then
    ln -sfn "${HUB_DIR}/skills/ai-hub" "${WORKSPACE_DIR}/.agents/skills/ai-hub"
    echo "✅ 已链接通用 Agent 技能: ${WORKSPACE_DIR}/.agents/skills/ai-hub"
  fi
fi

echo ""
echo "=== 4. 当前卡槽自检 ==="
node "${HUB_DIR}/bin/hub-ctl.mjs" status
echo ""
echo "🎉 部署完成！在 Antigravity 侧边栏/辅助窗格的「+」菜单中即可打开「多AI中枢」面板。"
