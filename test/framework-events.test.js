// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { QQBotPluginFramework } = require('../src/framework')

function silentLogger() {
  return { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }
}

test('主框架转发全量群消息、按钮互动和群成员加入事件', async () => {
  const bot = new EventEmitter()
  const framework = new QQBotPluginFramework(bot, {
    logger: silentLogger(),
    synchronizer: { async synchronize() {} },
    mysqlService: { async initialize() {}, async close() {}, forPlugin() {} },
    auditLog: {},
    temporaryImageHost: { async upload() {} },
    configStore: { async load() { return { webHost: '127.0.0.1', webPort: 0 } }, get() { return {} } },
    webAdmin: { async start() {}, async close() {} },
  })
  const dispatched = []
  const messageEvents = []
  const commandEvents = []
  framework.plugins.dispatchPluginEvent = async (type, event) => dispatched.push([type, event])
  framework.plugins.dispatchEvent = async (scope, event) => messageEvents.push([scope, event])
  framework.router.handle = async (scope, event) => commandEvents.push([scope, event])
  framework.bind()

  const acknowledgements = []
  const interaction = { async reply(code) { acknowledgements.push(code) } }
  const member = { group_id: 'group-1', user_id: 'user-1' }
  const groupMessage = { group_id: 'group-1', message_id: 'message-1', raw_message: '普通群消息' }
  bot.emit('message.group', groupMessage)
  bot.emit('notice.group.action', interaction)
  bot.emit('notice.group.member.increase', member)
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(acknowledgements, [0])
  assert.deepEqual(messageEvents, [['group', groupMessage]])
  assert.deepEqual(commandEvents, [['group', groupMessage]])
  assert.deepEqual(dispatched, [
    ['buttonInteraction', interaction],
    ['groupMemberAdd', member],
  ])
  framework.unbind()
})

test('全量群消息和群 @ 消息按消息 ID 去重执行指令', async () => {
  const bot = new EventEmitter()
  const framework = new QQBotPluginFramework(bot, {
    logger: silentLogger(),
    synchronizer: { async synchronize() {} },
    mysqlService: { async initialize() {}, async close() {}, forPlugin() {} },
    auditLog: {},
    temporaryImageHost: { async upload() {} },
    configStore: { async load() { return { webHost: '127.0.0.1', webPort: 0 } }, get() { return {} } },
    webAdmin: { async start() {}, async close() {} },
  })
  const commandEvents = []
  framework.plugins.dispatchEvent = async () => {}
  framework.router.handle = async (scope, event) => commandEvents.push([scope, event.raw_message])
  framework.bind()

  bot.emit('message.group', {
    group_id: 'group-1', message_id: 'message-1', raw_message: '测试',
  })
  bot.emit('message.group.at', {
    group_id: 'group-1', message_id: 'message-1', raw_message: '测试',
  })
  bot.emit('message.group', {
    group_id: 'group-1', message_id: 'message-2', raw_message: '测试 参数',
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(commandEvents, [
    ['group', '测试'],
    ['group', '测试 参数'],
  ])
  framework.unbind()
})

test('插件接收只有 @ 事件的群消息，并对全量与 @ 重复消息去重', async () => {
  const bot = new EventEmitter()
  const framework = new QQBotPluginFramework(bot, {
    logger: silentLogger(), synchronizer: { async synchronize() {} },
    mysqlService: { async initialize() {}, async close() {}, forPlugin() {} },
    temporaryImageHost: { async upload() {} },
  })
  const received = []
  framework.plugins.dispatchEvent = async (_scope, event) => received.push(event.message_id)
  framework.router.handle = async () => {}
  framework.bind()
  bot.emit('message.group.at', { group_id: 'one', message_id: 'at-only' })
  bot.emit('message.group', { group_id: 'one', message_id: 'both' })
  bot.emit('message.group.at', { group_id: 'one', message_id: 'both' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(received, ['at-only', 'both'])
  framework.unbind()
})
