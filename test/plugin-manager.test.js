// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PluginManager } = require('../src/plugin-manager')
const { CommandPanelSynchronizer } = require('../src/command-panel-sync')

function silentLogger() {
  return { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }
}

test('PluginManager 支持加载、卸载和重载插件', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-plugin-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const pluginPath = path.join(directory, 'fixture.cjs')
  const writePlugin = response => fs.writeFileSync(pluginPath, `
    module.exports = {
      name: 'fixture',
      setup({ registerCommand }) {
        registerCommand({
          name: '测试', description: '测试命令', scopes: ['c2c', 'group'],
          handler: async (_args, reply) => reply(${JSON.stringify(response)})
        })
      }
    }
  `)
  writePlugin('v1')

  const snapshots = []
  const manager = new PluginManager({
    bot: {},
    synchronizer: { synchronize: async commands => snapshots.push(commands.map(command => command.name)) },
    logger: silentLogger(),
    baseDir: directory,
  })

  await manager.load(pluginPath)
  assert.equal(manager.listPlugins()[0].name, 'fixture')
  const replies = []
  await manager.findCommand('c2c', '测试').handler(undefined, value => replies.push(value), {})
  assert.deepEqual(replies, ['v1'])

  writePlugin('v2')
  await manager.reload('fixture')
  await manager.findCommand('group', '测试').handler(undefined, value => replies.push(value), {})
  assert.deepEqual(replies, ['v1', 'v2'])

  await manager.unload('fixture')
  assert.deepEqual(manager.listPlugins(), [])
  assert.deepEqual(snapshots, [['测试'], [], ['测试'], []])
})

test('未获卡片名额与未申请的命令仍注册可用，插件收到审批回调', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-panel-registration-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'fixture.cjs'), `
    module.exports = { name: 'fixture', setup({ registerCommand, bot }) {
      for (let index = 0; index < 22; index++) registerCommand({
        name: 'cmd' + index, description: '测试', scopes: ['group'],
        inCommandPanel: index !== 21,
        handler: async (_args, reply) => reply('reply' + index),
        onPanelResult: result => bot.results.push(result)
      })
    }}
  `)
  const bot = { results: [], panels: [],
    async getCommandPanels() { return { records: [], is_end: true } },
    async createCommandPanel(options) { this.panels.push(options) },
  }
  const manager = new PluginManager({ bot, baseDir: directory, logger: silentLogger(),
    synchronizer: new CommandPanelSynchronizer(bot, silentLogger()) })
  t.after(() => manager.close())
  await manager.load('fixture.cjs')
  assert.equal(manager.listCommands().length, 22)
  assert.equal(bot.panels[0].panel.items.length, 20)
  assert.equal(bot.results.length, 22)
  assert.equal(bot.results[20].reason, 'capacity')
  assert.equal(bot.results[21].reason, 'not-requested')
  const replies = []
  await manager.findCommand('group', 'cmd20').handler(undefined, value => replies.push(value))
  await manager.findCommand('group', 'cmd21').handler(undefined, value => replies.push(value))
  assert.deepEqual(replies, ['reply20', 'reply21'])
})

test('第 21 个必选命令使插件加载失败，保留已注册命令且不改动 QQ 卡片', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-panel-required-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const [plugin, count] of [['first', 20], ['extra', 1]]) {
    fs.writeFileSync(path.join(directory, plugin + '.cjs'), `
      module.exports = { name: '${plugin}', setup({ registerCommand, bot }) {
        for (let i = 0; i < ${count}; i++) registerCommand({
          name: '${plugin}' + i, description: '必选', scopes: ['group'], required: true,
          handler() {}, onPanelResult: result => bot.results.push(result)
        })
        return () => bot.cleaned.push('${plugin}')
      }}
    `)
  }
  const bot = { requests: [], results: [], cleaned: [],
    async getCommandPanels({ scope }) { this.requests.push(['get', scope]); return { records: [], is_end: true } },
    async createCommandPanel(options) { this.requests.push(['create', options]) },
  }
  const manager = new PluginManager({ bot, baseDir: directory, logger: silentLogger(),
    synchronizer: new CommandPanelSynchronizer(bot, silentLogger()) })
  t.after(() => manager.close())
  await manager.load('first.cjs')
  const requestCount = bot.requests.length
  await assert.rejects(manager.load('extra.cjs'), /配置错误.*21.*20/u)
  assert.equal(bot.requests.length, requestCount)
  assert.equal(bot.results.length, 20)
  assert.equal(manager.listCommands().length, 20)
  assert.ok(manager.findCommand('group', 'first0'))
  assert.equal(manager.findCommand('group', 'extra0'), undefined)
  assert.deepEqual(bot.cleaned, ['extra'])
})

test('PluginManager 不区分大小写地查找命令并拒绝重复注册', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-plugin-conflict-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const [name, commandName, scopes] of [
    ['one', 'mcPlayer', 'group'],
    ['two', 'MCPLAYER', 'c2c'],
  ]) {
    fs.writeFileSync(path.join(directory, `${name}.cjs`), `
      module.exports = { name: '${name}', setup({ registerCommand }) {
        registerCommand({ name: '${commandName}', description: '玩家命令', scopes: '${scopes}', handler() {} })
      }}
    `)
  }
  const manager = new PluginManager({
    bot: {}, synchronizer: { synchronize: async () => {} }, logger: silentLogger(), baseDir: directory,
  })
  await manager.load('one.cjs')
  assert.equal(manager.findCommand('group', 'mcplayer').name, 'mcPlayer')
  assert.equal(manager.findCommand('group', 'MCPLAYER').name, 'mcPlayer')
  await assert.rejects(manager.load('two.cjs'), /已被注册/u)
})

test('PluginManager 通过插件上下文提供临时图片上传 API', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-plugin-upload-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'upload.cjs'), `
    module.exports = { name: 'upload', setup({ registerCommand, uploadTemporaryImage }) {
      registerCommand({
        name: '上传', description: '上传图片', scopes: 'group',
        handler: async (_args, reply) => reply(await uploadTemporaryImage('image-data'))
      })
    }}
  `)
  const uploads = []
  const manager = new PluginManager({
    bot: {},
    synchronizer: { synchronize: async () => {} },
    logger: silentLogger(),
    baseDir: directory,
    uploadTemporaryImage: async image => {
      uploads.push(image)
      return 'https://images.example/test.png'
    },
  })
  await manager.load('upload.cjs')
  const replies = []
  await manager.findCommand('group', '上传').handler(undefined, value => replies.push(value), {})
  assert.deepEqual(uploads, ['image-data'])
  assert.deepEqual(replies, ['https://images.example/test.png'])
  await manager.close()
})

test('PluginManager 按插件名提供受限 MySQL 对象', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-plugin-mysql-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'database.cjs'), `
    module.exports = { name: 'database-plugin', setup({ mysql, registerCommand }) {
      registerCommand({
        name: '数据库', description: '数据库对象', scopes: 'c2c',
        handler: async (_args, reply) => reply(mysql.pluginTablePrefix)
      })
    }}
  `)
  const requested = []
  const manager = new PluginManager({
    bot: {},
    synchronizer: { synchronize: async () => {} },
    logger: silentLogger(),
    baseDir: directory,
    mysql: {
      forPlugin(name) {
        requested.push(name)
        return { pluginTablePrefix: '_plugin_database_plugin_' }
      },
    },
  })
  await manager.load('database.cjs')
  const replies = []
  await manager.findCommand('c2c', '数据库').handler(undefined, value => replies.push(value), {})
  assert.deepEqual(requested, ['database-plugin'])
  assert.deepEqual(replies, ['_plugin_database_plugin_'])
  await manager.close()
})

test('PluginManager 审计事件回调及其 Markdown 回复', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-plugin-event-audit-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'event.cjs'), `
    module.exports = { name: 'event-plugin', setup({ onC2CMessage }) {
      onC2CMessage(async (_event, reply) => reply('事件回复'))
    }}
  `)
  const auditRecords = []
  const auditLog = {
    async recordCall(input) {
      auditRecords.push({ type: 'call', input })
      return { correlationId: 'event-1', scope: input.scope, command: input.command }
    },
    async recordReply(context, message) {
      auditRecords.push({ type: 'reply', context, message })
    },
  }
  const manager = new PluginManager({
    bot: {}, synchronizer: { synchronize: async () => {} }, logger: silentLogger(),
    baseDir: directory, auditLog,
  })
  await manager.load('event.cjs')
  const sent = []
  await manager.dispatchEvent('c2c', {
    raw_message: '普通消息',
    async reply(message) { sent.push(message); return { id: 'reply-1' } },
  })
  assert.equal(auditRecords.length, 2)
  assert.equal(auditRecords[0].input.command.name, '[c2c-message-event]')
  assert.equal(auditRecords[1].message.type, 'markdown')
  assert.equal(sent[0].data.content, '事件回复')
  await manager.close()
})

test('默认插件目录加载完成后只统一同步一次指令面板', async () => {
  const snapshots = []
  const manager = new PluginManager({
    bot: {},
    synchronizer: {
      synchronize: async commands => snapshots.push(commands.map(command => command.name).sort()),
    },
    logger: silentLogger(),
    baseDir: path.resolve(__dirname, '..'),
  })
  await manager.loadDirectory('plugins')
  assert.deepEqual(
    manager.listPlugins().map(plugin => plugin.name).sort(),
    [],
  )
  assert.equal(manager.listCommands().length, 0)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].length, 0)
  await manager.close()
})
