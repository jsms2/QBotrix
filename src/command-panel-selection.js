// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const COMMAND_PANEL_LIMIT = 20
const COMMAND_PRIORITIES = Object.freeze(['critical', 'high', 'normal', 'low', 'optional'])

function normalizeCommandPanelOptions(options) {
  const { inCommandPanel = true, priority = 'normal', required = false } = options
  const label = options.name ? `命令 /${options.name}` : '命令'
  if (typeof inCommandPanel !== 'boolean') throw new TypeError(`${label} 的 inCommandPanel 必须是布尔值`)
  if (typeof required !== 'boolean') throw new TypeError(`${label} 的 required 必须是布尔值`)
  if (!COMMAND_PRIORITIES.includes(priority)) {
    throw new TypeError(`${label} 的 priority 必须是 ${COMMAND_PRIORITIES.join('、')} 之一`)
  }
  if (required && !inCommandPanel) {
    throw new TypeError(`${label} 不能同时设置 required: true 和 inCommandPanel: false`)
  }
  return { inCommandPanel, priority, required }
}

function selectPanelCommands(commands) {
  const candidates = commands.map((command, index) => ({
    command, index, ...normalizeCommandPanelOptions(command),
  })).filter(item => item.inCommandPanel)
  const required = candidates.filter(item => item.required)
  if (required.length > COMMAND_PANEL_LIMIT) {
    const names = required.map(item => `${item.command.pluginName || '未知插件'}: /${item.command.name}`).join('、')
    throw new Error(`QQ 指令卡片配置错误：required: true 的命令有 ${required.length} 个，超过 ${COMMAND_PANEL_LIMIT} 个上限（${names}）`)
  }
  candidates.sort((left, right) => Number(right.required) - Number(left.required)
    || COMMAND_PRIORITIES.indexOf(left.priority) - COMMAND_PRIORITIES.indexOf(right.priority)
    || left.index - right.index)
  return {
    selected: candidates.slice(0, COMMAND_PANEL_LIMIT).map(item => item.command),
    excluded: candidates.slice(COMMAND_PANEL_LIMIT).map(item => ({ command: item.command, priority: item.priority })),
  }
}

module.exports = { COMMAND_PANEL_LIMIT, COMMAND_PRIORITIES, normalizeCommandPanelOptions, selectPanelCommands }
