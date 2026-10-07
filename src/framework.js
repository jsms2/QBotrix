// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const path = require('node:path')
const { CommandPanelSynchronizer } = require('./command-panel-sync')
const { CommandRouter } = require('./command-router')
const { PluginManager } = require('./plugin-manager')
const { createLogger } = require('./logger')
const { TemporaryImageHost } = require('./temporary-image-host')
const { createDatabaseService } = require('./database')
const { CallAuditLog } = require('./call-audit-log')
const { FrameworkConfigStore } = require('./framework-config')
const { WebAdminServer } = require('./web-admin')

class QQBotPluginFramework {
  constructor(bot, options = {}) {
    this.bot = bot
    this.baseDir = path.resolve(options.baseDir || process.cwd())
    this.logger = options.logger || createLogger('qqbot')
    this.configStore = options.configStore || new FrameworkConfigStore(
      path.join(this.baseDir, 'data', 'framework-config.json'),
      options.frameworkConfig,
    )
    this.synchronizer = options.synchronizer || new CommandPanelSynchronizer(bot, this.logger)
    this.temporaryImageHost = options.temporaryImageHost || new TemporaryImageHost(
      options.temporaryImageHostOptions,
    )
    this.mysql = options.databaseService || options.mysqlService || createDatabaseService({
      type: options.databaseType,
      baseDir: this.baseDir,
      mysqlOptions: options.mysqlOptions,
      sqliteOptions: options.sqliteOptions,
    })
    this.auditLog = options.auditLog || new CallAuditLog(this.mysql, this.logger)
    this.uploadTemporaryImage = this.temporaryImageHost.upload.bind(this.temporaryImageHost)
    this.plugins = new PluginManager({
      bot,
      synchronizer: this.synchronizer,
      logger: this.logger,
      baseDir: this.baseDir,
      uploadTemporaryImage: this.uploadTemporaryImage,
      mysql: this.mysql,
      auditLog: this.auditLog,
    })
    this.router = new CommandRouter(this.plugins, this.logger, this.auditLog)
    this.webAdmin = options.webAdmin || null
    this.webAdminOptions = options.webAdminOptions || {}
    this.bound = false
    this.listeners = {}
    this.groupCommandEventObjects = new WeakSet()
    this.groupCommandMessageIds = new Map()
    this.groupMessageEventObjects = new WeakSet()
    this.groupMessageIds = new Map()
  }

  async initialize() {
    const config = await this.configStore.load()
    await this.mysql.initialize()
    this.temporaryImageHost.configure?.(config, this.mysql)
    await this.temporaryImageHost.initialize?.()
    if (!this.webAdmin) {
      this.webAdmin = new WebAdminServer({
        pluginManager: this.plugins,
        configStore: this.configStore,
        logger: this.logger,
        host: this.webAdminOptions.host || config.webHost,
        port: this.webAdminOptions.port ?? config.webPort,
        token: this.webAdminOptions.token,
        temporaryImageHost: this.temporaryImageHost,
      })
    }
  }

  startWebAdmin() {
    if (!this.webAdmin) throw new Error('框架尚未初始化 Web 管理服务')
    return this.webAdmin.start()
  }

  routeGroupCommand(event) {
    if (event && typeof event === 'object') {
      if (this.groupCommandEventObjects.has(event)) return Promise.resolve(false)
      this.groupCommandEventObjects.add(event)
    }

    const groupId = String(event?.group_id || event?.group_openid || '')
    const messageId = String(event?.message_id || event?.id || '').trim()
    if (messageId) {
      const key = `${groupId}\0${messageId}`
      const now = Date.now()
      const previous = this.groupCommandMessageIds.get(key)
      if (previous && now - previous < 60_000) return Promise.resolve(false)
      this.groupCommandMessageIds.set(key, now)

      if (this.groupCommandMessageIds.size > 1024) {
        const cutoff = now - 60_000
        for (const [storedKey, timestamp] of this.groupCommandMessageIds) {
          if (timestamp < cutoff) this.groupCommandMessageIds.delete(storedKey)
        }
        while (this.groupCommandMessageIds.size > 1024) {
          const oldestKey = this.groupCommandMessageIds.keys().next().value
          this.groupCommandMessageIds.delete(oldestKey)
        }
      }
    }

    return this.router.handle('group', event)
  }

  bind() {
    if (this.bound) return
    this.listeners.group = event => {
      void Promise.all([
        this.dispatchGroupMessage(event),
        this.routeGroupCommand(event),
      ])
    }
    this.listeners.groupAt = this.listeners.group
    this.listeners.c2c = event => {
      void Promise.all([
        this.plugins.dispatchEvent('c2c', event),
        this.router.handle('c2c', event),
      ])
    }
    this.listeners.buttonInteraction = event => {
      void event.reply(0).catch(error => this.logger.error('回应按钮互动事件失败', error))
      void this.plugins.dispatchPluginEvent('buttonInteraction', event)
    }
    this.listeners.groupMemberAdd = event => {
      void this.plugins.dispatchPluginEvent('groupMemberAdd', event)
    }

    // 全量群消息和群 @ 消息都参与指令路由；若 SDK 同时抛出两种事件，则按消息 ID 去重。
    this.bot.on('message.group', this.listeners.group)
    this.bot.on('message.group.at', this.listeners.groupAt)
    this.bot.on('message.private.friend', this.listeners.c2c)
    this.bot.on('notice.group.action', this.listeners.buttonInteraction)
    this.bot.on('notice.group.member.increase', this.listeners.groupMemberAdd)
    this.bound = true
  }

  unbind() {
    if (!this.bound) return
    this.bot.off('message.group', this.listeners.group)
    this.bot.off('message.group.at', this.listeners.groupAt)
    this.bot.off('message.private.friend', this.listeners.c2c)
    this.bot.off('notice.group.action', this.listeners.buttonInteraction)
    this.bot.off('notice.group.member.increase', this.listeners.groupMemberAdd)
    this.listeners = {}
    this.groupCommandEventObjects = new WeakSet()
    this.groupCommandMessageIds.clear()
    this.groupMessageEventObjects = new WeakSet()
    this.groupMessageIds.clear()
    this.bound = false
  }

  dispatchGroupMessage(event) {
    if (event && typeof event === 'object') {
      if (this.groupMessageEventObjects.has(event)) return Promise.resolve()
      this.groupMessageEventObjects.add(event)
    }
    const messageId = String(event?.message_id || event?.id || '').trim()
    if (messageId) {
      const key = `${event?.group_id || event?.group_openid || ''}\0${messageId}`
      const now = Date.now()
      if (now - (this.groupMessageIds.get(key) || 0) < 60_000) return Promise.resolve()
      this.groupMessageIds.set(key, now)
      if (this.groupMessageIds.size > 1024) {
        for (const [id, timestamp] of this.groupMessageIds) {
          if (now - timestamp >= 60_000) this.groupMessageIds.delete(id)
        }
        while (this.groupMessageIds.size > 1024) this.groupMessageIds.delete(this.groupMessageIds.keys().next().value)
      }
    }
    return this.plugins.dispatchEvent('group', event)
  }

  async close() {
    this.unbind()
    try {
      await this.webAdmin?.close()
      await this.plugins.close()
    } finally {
      try { await this.temporaryImageHost.close?.() }
      finally { await this.mysql.close() }
    }
  }
}

module.exports = { QQBotPluginFramework }
