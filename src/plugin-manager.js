// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createReply } = require('./command-router')
const { normalizeCommandPanelOptions } = require('./command-panel-selection')

const VALID_SCOPES = new Set(['c2c', 'group'])

function normalizeCommandName(name) {
  return String(name).toLowerCase()
}

function normalizeScopes(value) {
  const scopes = typeof value === 'string' ? [value] : value
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError('命令 scopes 必须是 c2c、group 或它们组成的非空数组')
  }
  const unique = [...new Set(scopes)]
  for (const scope of unique) {
    if (!VALID_SCOPES.has(scope)) throw new TypeError(`不支持的命令作用范围: ${scope}`)
  }
  return unique
}

function normalizeCommand(options, pluginName) {
  if (!options || typeof options !== 'object') throw new TypeError('registerCommand 需要一个配置对象')
  const name = String(options.name || '').trim()
  const description = String(options.description || '').trim()
  if (!name || name.includes('/') || /\s/u.test(name)) {
    throw new TypeError('命令名称不能为空，且不能包含 / 或空白字符')
  }
  if (!description) throw new TypeError(`命令 /${name} 缺少 description`)
  if (typeof options.handler !== 'function') throw new TypeError(`命令 /${name} 缺少 handler 函数`)
  if (options.onPanelResult !== undefined && typeof options.onPanelResult !== 'function') {
    throw new TypeError(`命令 /${name} 的 onPanelResult 必须是函数`)
  }
  return {
    name,
    description,
    scopes: normalizeScopes(options.scopes),
    handler: options.handler,
    pluginName,
    ...normalizeCommandPanelOptions(options),
    onPanelResult: options.onPanelResult,
  }
}

function resolvePluginExport(exported) {
  const candidate = exported?.default || exported
  if (typeof candidate === 'function') return { setup: candidate }
  if (!candidate || typeof candidate.setup !== 'function') {
    throw new TypeError('插件必须导出 setup(context) 函数，或直接导出一个函数')
  }
  return candidate
}

function clearPluginCache(moduleId) {
  const entry = require.cache[moduleId]
  if (!entry) return
  const pluginRoot = path.dirname(moduleId)
  const visited = new Set()

  function visit(module) {
    if (!module || visited.has(module.id)) return
    visited.add(module.id)
    for (const child of module.children || []) {
      if (child.filename.startsWith(pluginRoot) && !child.filename.includes(`${path.sep}node_modules${path.sep}`)) {
        visit(child)
      }
    }
    delete require.cache[module.id]
  }
  visit(entry)
}

class PluginManager {
  constructor({ bot, synchronizer, logger, baseDir = process.cwd(), uploadTemporaryImage, mysql, auditLog, webBasePath = '/plugins' }) {
    this.bot = bot
    this.synchronizer = synchronizer
    this.logger = logger
    this.baseDir = path.resolve(baseDir)
    this.uploadTemporaryImage = uploadTemporaryImage
    this.mysql = mysql
    this.auditLog = auditLog
    this.webBasePath = String(webBasePath).replace(/\/$/u, '')
    this.plugins = new Map()
    this.operationQueue = Promise.resolve()
  }

  load(pluginPath) {
    return this.#enqueue(() => this.#load(pluginPath))
  }

  unload(pluginName) {
    return this.#enqueue(() => this.#unload(pluginName, true))
  }

  reload(pluginName) {
    return this.#enqueue(async () => {
      const record = this.plugins.get(pluginName)
      if (!record) throw new Error(`插件未加载: ${pluginName}`)
      const pluginPath = record.path
      await this.#unload(pluginName, true)
      return this.#load(pluginPath)
    })
  }

  loadDirectory(directory = 'plugins') {
    return this.#enqueue(async () => {
      const absoluteDirectory = path.isAbsolute(directory) ? directory : path.resolve(this.baseDir, directory)
      if (!fs.existsSync(absoluteDirectory)) return []
      const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .filter(entry => entry.isDirectory() || /\.(?:c?js)$/iu.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))

      const loaded = []
      const failures = []
      for (const entry of entries) {
        const candidate = path.join(absoluteDirectory, entry.name)
        try {
          loaded.push(await this.#load(candidate, false))
        } catch (error) {
          failures.push(error)
          this.logger.error(`加载插件 ${candidate} 失败`, error)
        }
      }
      if (failures.length) throw new AggregateError(failures, `${failures.length} 个插件加载失败`)
      await this.synchronizer.synchronize(this.listCommands())
      return loaded
    })
  }

  close() {
    return this.#enqueue(async () => {
      const records = [...this.plugins.values()].reverse()
      this.plugins.clear()
      for (const record of records) await this.#dispose(record)
    })
  }

  listPlugins() {
    return [...this.plugins.values()].map(record => ({
      name: record.name,
      path: record.path,
      commandCount: record.commands.length,
      groupMessageHandlerCount: record.events.group.length,
      c2cMessageHandlerCount: record.events.c2c.length,
      buttonInteractionHandlerCount: record.events.buttonInteraction.length,
      groupMemberAddHandlerCount: record.events.groupMemberAdd.length,
      configUrl: record.webPage?.urlPrefix,
    }))
  }

  listCommands(excludePluginName) {
    return [...this.plugins.values()]
      .filter(record => record.name !== excludePluginName)
      .flatMap(record => record.commands)
  }

  findCommand(scope, name) {
    const normalizedName = normalizeCommandName(name)
    return this.listCommands().find(command =>
      normalizeCommandName(command.name) === normalizedName && command.scopes.includes(scope))
  }

  getWebPage(pluginName) {
    return this.plugins.get(pluginName)?.webPage
  }

  async dispatchPluginEvent(type, event) {
    const handlers = [...this.plugins.values()].flatMap(record =>
      (record.events[type] || []).map(handler => ({ handler, pluginName: record.name })))
    const results = await Promise.allSettled(handlers.map(({ handler }) => handler(event)))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(`插件 ${handlers[index].pluginName} 的 ${type} 事件回调执行失败`, result.reason)
      }
    })
    return results
  }

  async dispatchEvent(scope, event) {
    const handlers = [...this.plugins.values()].flatMap(record =>
      record.events[scope].map(handler => ({ handler, pluginName: record.name })))

    const results = await Promise.allSettled(handlers.map(async ({ handler, pluginName }) => {
      const command = { pluginName, name: `[${scope}-message-event]` }
      let auditContext
      if (this.auditLog) {
        try {
          auditContext = await this.auditLog.recordCall({ scope, command, args: undefined, event })
        } catch (error) {
          this.logger.error(`记录插件 ${pluginName} 的 ${scope} 事件调用失败`, error)
        }
      }
      const reply = createReply(event, {
        onReply: async (message, result, error) => {
          if (!this.auditLog || !auditContext) return
          try {
            await this.auditLog.recordReply(auditContext, message, result, error)
          } catch (auditError) {
            this.logger.error(`记录插件 ${pluginName} 的 ${scope} 事件回复失败`, auditError)
          }
        },
      })
      return handler(event, reply)
    }))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(`插件 ${handlers[index].pluginName} 的 ${scope} 消息回调执行失败`, result.reason)
      }
    })
  }

  #enqueue(operation) {
    const run = this.operationQueue.then(operation)
    this.operationQueue = run.catch(() => undefined)
    return run
  }

  async #load(pluginPath, synchronize = true) {
    const absolutePath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(this.baseDir, pluginPath)
    const moduleId = require.resolve(absolutePath)
    clearPluginCache(moduleId)
    const plugin = resolvePluginExport(require(moduleId))
    const pluginName = String(plugin.name || path.basename(moduleId, path.extname(moduleId))).trim()
    if (!pluginName) throw new TypeError(`插件 ${moduleId} 没有有效名称`)
    if (this.plugins.has(pluginName)) throw new Error(`插件名称重复: ${pluginName}`)

    const staged = {
      commands: [],
      events: { group: [], c2c: [], buttonInteraction: [], groupMemberAdd: [] },
      webPage: null,
    }
    const pluginLogger = this.logger.child(pluginName)
    const context = {
      bot: this.bot,
      logger: pluginLogger,
      mysql: this.mysql?.forPlugin(pluginName),
      uploadTemporaryImage: (...args) => {
        if (typeof this.uploadTemporaryImage !== 'function') {
          throw new Error('框架没有配置临时图片上传服务')
        }
        return this.uploadTemporaryImage(...args)
      },
      registerCommand: options => {
        const command = normalizeCommand(options, pluginName)
        staged.commands.push(command)
        return command
      },
      onGroupMessage: handler => {
        if (typeof handler !== 'function') throw new TypeError('onGroupMessage 需要函数')
        staged.events.group.push(handler)
      },
      onC2CMessage: handler => {
        if (typeof handler !== 'function') throw new TypeError('onC2CMessage 需要函数')
        staged.events.c2c.push(handler)
      },
      onButtonInteraction: handler => {
        if (typeof handler !== 'function') throw new TypeError('onButtonInteraction 需要函数')
        staged.events.buttonInteraction.push(handler)
      },
      onGroupMemberAdd: handler => {
        if (typeof handler !== 'function') throw new TypeError('onGroupMemberAdd 需要函数')
        staged.events.groupMemberAdd.push(handler)
      },
      registerWebPage: options => {
        if (!options || typeof options !== 'object') throw new TypeError('registerWebPage 需要配置对象')
        if (staged.webPage) throw new Error(`插件 ${pluginName} 已注册网页配置页面`)
        if (typeof options.handler !== 'function') throw new TypeError('插件网页缺少 handler 函数')
        const title = String(options.title || `${pluginName} 配置`).trim()
        const urlPrefix = `${this.webBasePath}/${encodeURIComponent(pluginName)}`
        staged.webPage = { title, handler: options.handler, urlPrefix }
        return urlPrefix
      },
    }

    let setupCleanup
    let disposed = false
    try {
      setupCleanup = await plugin.setup(context)
      if (setupCleanup !== undefined && typeof setupCleanup !== 'function') {
        throw new TypeError(`插件 ${pluginName} 的 setup 返回值必须是清理函数或 undefined`)
      }
      this.#validateCommandConflicts(staged.commands)

      const record = {
        name: pluginName,
        path: moduleId,
        plugin,
        setupCleanup,
        commands: staged.commands,
        events: staged.events,
        webPage: staged.webPage,
      }
      this.plugins.set(pluginName, record)
      if (synchronize) {
        try {
          await this.synchronizer.synchronize(this.listCommands())
        } catch (error) {
          this.plugins.delete(pluginName)
          await this.#dispose(record)
          disposed = true
          throw error
        }
      }
      this.logger.info(`插件已加载: ${pluginName}`)
      return this.listPlugins().find(item => item.name === pluginName)
    } catch (error) {
      if (!disposed && !this.plugins.has(pluginName)) {
        await this.#dispose({ name: pluginName, plugin, setupCleanup })
      }
      clearPluginCache(moduleId)
      throw error
    }
  }

  async #unload(pluginName, synchronize) {
    const record = this.plugins.get(pluginName)
    if (!record) throw new Error(`插件未加载: ${pluginName}`)
    if (synchronize) await this.synchronizer.synchronize(this.listCommands(pluginName))
    this.plugins.delete(pluginName)
    await this.#dispose(record)
    clearPluginCache(record.path)
    this.logger.info(`插件已卸载: ${pluginName}`)
  }

  #validateCommandConflicts(commands) {
    const occupied = new Set()
    for (const command of this.listCommands()) {
      occupied.add(normalizeCommandName(command.name))
    }
    for (const command of commands) {
      const key = normalizeCommandName(command.name)
      if (occupied.has(key)) throw new Error(`命令 /${command.name} 已被注册（命令名称不区分大小写）`)
      occupied.add(key)
    }
  }

  async #dispose(record) {
    const disposers = [record.setupCleanup, record.plugin.teardown].filter(value => typeof value === 'function')
    for (const dispose of disposers) {
      try {
        await dispose.call(record.plugin)
      } catch (error) {
        this.logger.error(`插件 ${record.name} 清理失败`, error)
      }
    }
  }
}

module.exports = { PluginManager, clearPluginCache, normalizeCommand, normalizeCommandName, normalizeScopes }
