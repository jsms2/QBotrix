// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { MessageBuilder } = require('qq-official-bot')
const { CommandRouter, createReply, parseCommandText } = require('../src/command-router')

test('parseCommandText 同时解析带 / 和不带 / 的命令', () => {
  assert.deepEqual(parseCommandText('  /测试  '), { name: '测试', args: undefined })
  assert.deepEqual(parseCommandText('/测试 hello world'), { name: '测试', args: 'hello world' })
  assert.deepEqual(parseCommandText('/测试  hello'), { name: '测试', args: ' hello' })
  assert.deepEqual(parseCommandText('测试'), { name: '测试', args: undefined })
  assert.deepEqual(parseCommandText('测试 hello world'), { name: '测试', args: 'hello world' })
  assert.deepEqual(parseCommandText('测试  hello'), { name: '测试', args: ' hello' })
  assert.equal(parseCommandText('/'), null)
  assert.equal(parseCommandText(''), null)
})

test('CommandRouter 按作用域调用命令并提供 reply', async () => {
  const calls = []
  const command = {
    name: '测试',
    pluginName: 'example',
    scopes: ['group'],
    async handler(args, reply, event) {
      calls.push([args, event.id])
      await reply(args || '测试')
    },
  }
  const manager = { findCommand: (scope, name) => scope === 'group' && name === '测试' ? command : undefined }
  const logger = { error: error => { throw error } }
  const router = new CommandRouter(manager, logger)
  const replies = []
  const handled = await router.handle('group', {
    id: 'message-1',
    raw_message: ' /测试 参数 ',
    reply: async message => replies.push(message),
  })

  assert.equal(handled, true)
  assert.deepEqual(calls, [['参数', 'message-1']])
  assert.equal(replies.length, 1)
  assert.equal(replies[0][0].type, 'reply')
  assert.equal(replies[0][0].data.id, 'message-1')
  assert.equal(replies[0][1].type, 'markdown')
  assert.equal(replies[0][1].data.content, '参数')
  assert.equal(replies[0][1].data.force_verify_image_resource, true)
  const built = await new MessageBuilder('test-appid', false).build(replies[0])
  assert.equal(built.messagePayload.message_reference.message_id, 'message-1')
  assert.equal(built.messagePayload.markdown.content, '参数')
})

test('CommandRouter 可调用不带 / 的命令', async () => {
  const calls = []
  const command = {
    name: '测试',
    pluginName: 'example',
    scopes: ['c2c'],
    async handler(args, reply) {
      calls.push(args)
      await reply(args)
    },
  }
  const manager = { findCommand: (scope, name) => scope === 'c2c' && name === '测试' ? command : undefined }
  const router = new CommandRouter(manager, { error: error => { throw error } })
  const replies = []

  const handled = await router.handle('c2c', {
    id: 'message-2',
    raw_message: ' 测试 直接调用 ',
    reply: async message => replies.push(message),
  })

  assert.equal(handled, true)
  assert.deepEqual(calls, ['直接调用'])
  assert.equal(replies.length, 1)
  assert.equal(replies[0][0].type, 'reply')
  assert.equal(replies[0][0].data.id, 'message-2')
  assert.equal(replies[0][1].type, 'markdown')
  assert.equal(replies[0][1].data.content, '直接调用')
})

test('框架 reply 只允许 Markdown 回复', async () => {
  const replies = []
  const reply = createReply({ reply: async message => replies.push(message) })
  await reply('# Markdown')
  assert.equal(replies[0].type, 'markdown')
  await assert.rejects(reply([{ type: 'text', data: { text: '普通文本' } }]), /只接受 Markdown/u)
})

test('CommandRouter 记录用户调用和机器人回复', async () => {
  const records = []
  const command = {
    name: '审计',
    pluginName: 'audit-plugin',
    scopes: ['c2c'],
    async handler(args, reply) { await reply(`回复 ${args}`) },
  }
  const auditLog = {
    async recordCall(input) {
      records.push({ type: 'call', input })
      return { correlationId: 'correlation-1', scope: input.scope, command: input.command }
    },
    async recordReply(context, message, result, error) {
      records.push({ type: 'reply', context, message, result, error })
    },
  }
  const router = new CommandRouter(
    { findCommand: () => command },
    { error: error => { throw error } },
    auditLog,
  )
  await router.handle('c2c', {
    id: 'message-3',
    raw_message: '审计 参数',
    sender: { user_openid: 'user-1' },
    async reply() { return { id: 'reply-1' } },
  })
  assert.equal(records.length, 2)
  assert.equal(records[0].type, 'call')
  assert.equal(records[0].input.args, '参数')
  assert.equal(records[1].type, 'reply')
  assert.equal(records[1].message.type, 'markdown')
  assert.equal(records[1].message.data.content, '回复 参数')
})
