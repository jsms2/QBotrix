// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const { segment } = require('qq-official-bot')

/**
 * 去除首尾空白，移除可选的前导 /，并严格按第一个空白字符拆分命令和参数。
 * 没有参数时返回 undefined；参数内部的空白保持原样。
 */
function parseCommandText(content) {
  if (typeof content !== 'string') return null
  const text = content.trim()
  if (!text) return null

  const separator = text.search(/\s/u)
  const head = separator === -1 ? text : text.slice(0, separator)
  const name = head.startsWith('/') ? head.slice(1) : head
  if (!name || name.includes('/')) return null

  return {
    name,
    args: separator === -1 ? undefined : text.slice(separator + 1),
  }
}

function createReply(event, options = {}) {
  if (!event || typeof event.reply !== 'function') {
    throw new TypeError('消息事件没有可用的 reply 方法')
  }
  return async message => {
    let normalized
    if (typeof message === 'string') {
      normalized = segment.markdown(message, { force_verify_image_resource: true })
    } else if (message?.type === 'markdown') {
      normalized = message
    } else {
      throw new TypeError('框架 reply 只接受 Markdown 字符串或 Markdown 消息')
    }

    try {
      const sendable = options.quote ? [segment.reply(event), normalized] : normalized
      const result = await event.reply(sendable)
      await options.onReply?.(normalized, result, null)
      return result
    } catch (error) {
      await options.onReply?.(normalized, null, error)
      throw error
    }
  }
}

class CommandRouter {
  constructor(pluginManager, logger, auditLog) {
    this.pluginManager = pluginManager
    this.logger = logger
    this.auditLog = auditLog
  }

  async handle(scope, event) {
    const content = event?.raw_message ?? event?.content
    const parsed = parseCommandText(content)
    if (!parsed) return false

    const command = this.pluginManager.findCommand(scope, parsed.name)
    if (!command) return false

    let auditContext
    if (this.auditLog) {
      try {
        auditContext = await this.auditLog.recordCall({ scope, command, args: parsed.args, event })
      } catch (error) {
        this.logger.error('记录用户功能调用失败', error)
      }
    }
    const reply = createReply(event, {
      quote: true,
      onReply: async (message, result, error) => {
        if (!this.auditLog || !auditContext) return
        try {
          await this.auditLog.recordReply(auditContext, message, result, error)
        } catch (auditError) {
          this.logger.error('记录机器人回复失败', auditError)
        }
      },
    })

    try {
      await command.handler(parsed.args, reply, event)
    } catch (error) {
      this.logger.error(`插件 ${command.pluginName} 的 /${command.name} 命令执行失败`, error)
    }
    return true
  }
}

module.exports = { CommandRouter, createReply, parseCommandText }
