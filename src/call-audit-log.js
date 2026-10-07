// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const { randomUUID } = require('node:crypto')
const { FRAMEWORK_LOG_TABLE } = require('./mysql')

function safeJson(value) {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString()
    if (typeof item === 'function') return undefined
    if (!item || typeof item !== 'object') return item
    if (seen.has(item)) return '[Circular]'
    seen.add(item)
    return item
  })
}

function eventIdentity(event) {
  return {
    userId: event?.sender?.user_openid
      || event?.user_id
      || event?.author?.user_openid
      || event?.author?.member_openid
      || event?.author?.id
      || null,
    groupId: event?.group_id || event?.group_openid || null,
    messageId: event?.message_id || event?.id || null,
  }
}

function replyContent(message) {
  if (typeof message === 'string') return message
  if (message?.type === 'markdown') return message.data?.content || null
  return null
}

class CallAuditLog {
  constructor(mysql, logger) {
    this.mysql = mysql
    this.logger = logger
  }

  async recordCall({ scope, command, args, event }) {
    const correlationId = randomUUID()
    const identity = eventIdentity(event)
    await this.mysql.executeFramework(
      `INSERT INTO \`${FRAMEWORK_LOG_TABLE}\`
        (correlation_id, entry_type, status, scope, plugin_name, command_name,
         user_id, group_id, message_id, content, details)
       VALUES (?, 'user_call', 'received', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        correlationId,
        scope,
        command.pluginName,
        command.name,
        identity.userId,
        identity.groupId,
        identity.messageId,
        event?.raw_message ?? event?.content ?? null,
        safeJson({ args, event }),
      ],
    )
    return { correlationId, ...identity, scope, command }
  }

  async recordReply(context, message, result, error) {
    if (!context) return
    await this.mysql.executeFramework(
      `INSERT INTO \`${FRAMEWORK_LOG_TABLE}\`
        (correlation_id, entry_type, status, scope, plugin_name, command_name,
         user_id, group_id, message_id, content, details, error_message)
       VALUES (?, 'bot_reply', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        context.correlationId,
        error ? 'failed' : 'sent',
        context.scope,
        context.command.pluginName,
        context.command.name,
        context.userId,
        context.groupId,
        context.messageId,
        replyContent(message),
        safeJson({ message, result }),
        error?.message || (error ? String(error) : null),
      ],
    )
  }
}

module.exports = { CallAuditLog, eventIdentity, replyContent, safeJson }
