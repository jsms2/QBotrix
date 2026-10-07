// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const { COMMAND_PANEL_LIMIT, normalizeCommandPanelOptions, selectPanelCommands } = require('./command-panel-selection')

const SCOPES = ['c2c', 'group']
const ITEMS_PER_PANEL = COMMAND_PANEL_LIMIT
const DESCRIPTION_MAX_UNITS = 30
// Preserve the existing marker so upgrades can find previously created panels.
const MARKER_PREFIX = 'qq-plugin-framework'

function panelTextUnits(value) {
  return [...String(value)].reduce(
    (total, character) => total + (character.codePointAt(0) <= 0x7f ? 1 : 2),
    0,
  )
}

function truncatePanelText(value, maxUnits) {
  const text = String(value)
  if (panelTextUnits(text) <= maxUnits) return text
  const suffix = '…'
  const contentLimit = maxUnits - panelTextUnits(suffix)
  let result = ''
  let units = 0
  for (const character of text) {
    const characterUnits = character.codePointAt(0) <= 0x7f ? 1 : 2
    if (units + characterUnits > contentLimit) break
    result += character
    units += characterUnits
  }
  return result + suffix
}

function panelMarker(scope, index) {
  return `${MARKER_PREFIX}:${scope}:${index}`
}

function managedPanelIndex(record, scope) {
  const match = new RegExp(`^${MARKER_PREFIX}:${scope}:(\\d+)$`, 'u').exec(record?.panel?.remark || '')
  return match ? Number(match[1]) : null
}

function samePanel(actual, expected) {
  return JSON.stringify({
    items: actual?.items || [],
    remark: actual?.remark,
  }) === JSON.stringify(expected)
}

class CommandPanelSynchronizer {
  constructor(bot, logger) {
    this.bot = bot
    this.logger = logger
    this.queue = Promise.resolve()
  }

  synchronize(commands) {
    const run = this.queue.then(() => this.#synchronize(commands))
    this.queue = run.catch(() => undefined)
    return run
  }

  async #synchronize(commands) {
    // Select once across all plugins/scopes, before any QQ API request.
    const { selected, excluded } = selectPanelCommands(commands)
    for (const { command, priority } of excluded) {
      const log = this.logger.warn || this.logger.info
      log.call(this.logger, `QQ 指令卡片名额不足，未添加命令 /${command.name}（插件 ${command.pluginName || '未知插件'}，priority: ${priority}）；命令仍可正常使用`)
    }
    for (const scope of SCOPES) {
      const scopedCommands = selected
        .filter(command => command.scopes.includes(scope))

      const desiredPanels = scopedCommands.length ? [{
        items: scopedCommands.map(command => {
          const desc = truncatePanelText(command.description, DESCRIPTION_MAX_UNITS)
          if (desc !== command.description) {
            this.logger.warn?.(`命令 /${command.name} 的描述超过 QQ 指令面板限制，上传时已截短`)
          }
          return {
            name: command.name,
            type: 'command',
            desc,
            only_admin: false,
          }
        }),
        remark: panelMarker(scope, 0),
      }] : []

      await this.#synchronizeScope(scope, desiredPanels)
    }
    this.logger.info('QQ 指令面板已同步')
    const approved = new Set(selected)
    for (const command of commands) {
      if (typeof command.onPanelResult !== 'function') continue
      const options = normalizeCommandPanelOptions(command)
      try {
        await command.onPanelResult({
          name: command.name,
          pluginName: command.pluginName,
          requested: options.inCommandPanel,
          approved: approved.has(command),
          priority: options.priority,
          required: options.required,
          reason: !options.inCommandPanel ? 'not-requested' : approved.has(command) ? 'approved' : 'capacity',
        })
      } catch (error) {
        this.logger.error?.(`插件 ${command.pluginName || '未知插件'} 命令 /${command.name} 的 onPanelResult 回调失败`, error)
      }
    }
  }

  async #synchronizeScope(scope, desiredPanels) {
    const records = await this.#getAllPanels(scope)
    const managed = new Map()

    for (const record of records) {
      const index = managedPanelIndex(record, scope)
      if (index !== null) managed.set(index, record)
    }

    for (let index = 0; index < desiredPanels.length; index += 1) {
      const desired = desiredPanels[index]
      const existing = managed.get(index)
      if (!existing) {
        await this.bot.createCommandPanel({
          scope,
          target_type: 'all',
          panel: desired,
        })
      } else if (!samePanel(existing.panel, desired)) {
        await this.bot.updateCommandPanel(existing.panel_id, desired)
      }
      managed.delete(index)
    }

    for (const extra of managed.values()) {
      await this.bot.deleteCommandPanel(extra.panel_id)
    }
  }

  async #getAllPanels(scope) {
    const records = []
    let cursor
    const seenCursors = new Set()

    while (true) {
      const page = await this.bot.getCommandPanels({ scope, cursor, limit: 50 })
      records.push(...(page.records || []))
      if (page.is_end || !page.next_cursor) break
      if (seenCursors.has(page.next_cursor)) {
        throw new Error(`查询 ${scope} 指令面板时服务端重复返回 cursor`)
      }
      seenCursors.add(page.next_cursor)
      cursor = page.next_cursor
    }
    return records
  }
}

module.exports = {
  CommandPanelSynchronizer,
  DESCRIPTION_MAX_UNITS,
  ITEMS_PER_PANEL,
  MARKER_PREFIX,
  managedPanelIndex,
  panelTextUnits,
  panelMarker,
  truncatePanelText,
}
