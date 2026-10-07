// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CommandPanelSynchronizer,
  DESCRIPTION_MAX_UNITS,
  panelMarker,
  panelTextUnits,
} = require('../src/command-panel-sync')

function createFakeBot(initial = []) {
  const records = [...initial]
  const calls = []
  let nextId = 1
  return {
    records,
    calls,
    async getCommandPanels({ scope }) {
      calls.push(['get', scope])
      return { records: records.filter(record => record.scope === scope), is_end: true, next_cursor: '' }
    },
    async createCommandPanel(options) {
      calls.push(['create', options.scope])
      records.push({ panel_id: `new-${nextId++}`, version: 1, ...options })
    },
    async updateCommandPanel(panelId, panel) {
      calls.push(['update', panelId])
      records.find(record => record.panel_id === panelId).panel = panel
    },
    async deleteCommandPanel(panelId) {
      calls.push(['delete', panelId])
      const index = records.findIndex(record => record.panel_id === panelId)
      records.splice(index, 1)
    },
  }
}

test('同步器分别维护 c2c/group 面板且保留非框架面板', async () => {
  const userPanel = {
    panel_id: 'user-panel', scope: 'group', target_type: 'all', version: 1,
    panel: { items: [], remark: 'manually-created' },
  }
  const stalePanel = {
    panel_id: 'stale', scope: 'group', target_type: 'all', version: 1,
    panel: { items: [], remark: panelMarker('group', 1) },
  }
  const bot = createFakeBot([userPanel, stalePanel])
  const synchronizer = new CommandPanelSynchronizer(bot, { info() {} })
  await synchronizer.synchronize([{
    name: '测试', description: '测试命令', scopes: ['c2c', 'group'], pluginName: 'example', handler() {},
  }])

  assert.ok(bot.records.some(record => record.panel_id === 'user-panel'))
  assert.ok(!bot.records.some(record => record.panel_id === 'stale'))
  for (const scope of ['c2c', 'group']) {
    const record = bot.records.find(item => item.panel?.remark === panelMarker(scope, 0))
    assert.equal(record.panel.items[0].name, '测试')
    assert.equal(record.panel.items[0].desc, '测试命令')
  }
})

test('所有作用域共用 20 个命令名额，淘汰日志和回调包含申请结果', async () => {
  const warnings = []
  const results = []
  const bot = createFakeBot()
  const synchronizer = new CommandPanelSynchronizer(bot, { info() {}, warn(message) { warnings.push(message) } })
  const commands = Array.from({ length: 21 }, (_, index) => ({
    name: 'cmd' + index, description: '测试', pluginName: 'demo',
    scopes: index === 0 ? ['c2c', 'group'] : [index % 2 ? 'c2c' : 'group'],
    async onPanelResult(result) {
      // Callbacks only run after both scope panels have been written.
      assert.equal(bot.records.length, 2)
      await Promise.resolve()
      results.push(result)
    },
  }))
  commands.push({ name: 'hidden', description: '隐藏', scopes: ['group'], inCommandPanel: false,
    onPanelResult(result) { results.push(result) } })
  await synchronizer.synchronize(commands)
  const names = new Set(bot.records.flatMap(record => record.panel.items.map(item => item.name)))
  assert.equal(names.size, 20)
  assert.ok(names.has('cmd0'))
  assert.ok(!names.has('cmd20'))
  assert.ok(!names.has('hidden'))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /cmd20.*demo.*priority: normal/u)
  assert.equal(results.length, 22)
  assert.equal(results.filter(result => result.approved).length, 20)
  assert.deepEqual(results[20], { name: 'cmd20', pluginName: 'demo', requested: true, approved: false,
    priority: 'normal', required: false, reason: 'capacity' })
  assert.equal(results[21].approved, false)
  assert.equal(results[21].requested, false)
  assert.equal(results[21].reason, 'not-requested')
  const callsBefore = bot.calls.length
  await synchronizer.synchronize(commands)
  assert.deepEqual(bot.calls.slice(callsBefore), [['get', 'c2c'], ['get', 'group']])
  assert.deepEqual(results.slice(22), results.slice(0, 22))
})

test('必选命令超过 20 时在任何 QQ API 请求前报错，队列仍可恢复', async () => {
  const bot = createFakeBot()
  const results = []
  const synchronizer = new CommandPanelSynchronizer(bot, { info() {} })
  const commands = Array.from({ length: 21 }, (_, index) => ({
    name: 'required' + index, description: '必选', required: true,
    scopes: [index % 2 ? 'c2c' : 'group'], onPanelResult(result) { results.push(result) },
  }))
  await assert.rejects(synchronizer.synchronize(commands), /配置错误.*21.*20/u)
  assert.deepEqual(bot.calls, [])
  assert.deepEqual(results, [])
  await synchronizer.synchronize(commands.slice(0, 20))
  assert.equal(results.length, 20)
  assert.ok(results.every(result => result.approved))
})

test('卡片同步失败不回调申请通过，回调异常不撤销同步且继续通知其他命令', async () => {
  const bot = createFakeBot()
  const errors = []
  const results = []
  const synchronizer = new CommandPanelSynchronizer(bot, { info() {}, error(...args) { errors.push(args) } })
  const create = bot.createCommandPanel
  bot.createCommandPanel = async () => { throw new Error('QQ API 失败') }
  const commands = [{ name: 'one', description: '测试', scopes: ['group'],
    onPanelResult() { throw new Error('插件回调异常') } },
  { name: 'two', description: '测试', scopes: ['group'], onPanelResult(result) { results.push(result) } }]
  await assert.rejects(synchronizer.synchronize(commands), /QQ API 失败/u)
  assert.deepEqual(results, [])
  assert.deepEqual(errors, [])
  bot.createCommandPanel = create
  await synchronizer.synchronize(commands)
  assert.equal(results.length, 1)
  assert.equal(results[0].approved, true)
  assert.equal(errors.length, 1)
  assert.match(errors[0][0], /one.*onPanelResult/u)
  assert.equal(bot.records[0].panel.items.length, 2)
})

test('插件变动重新分配名额时通知原先未入选的命令，并清理空作用域面板', async () => {
  const bot = createFakeBot()
  const results = []
  const synchronizer = new CommandPanelSynchronizer(bot, { info() {}, warn() {} })
  const commands = Array.from({ length: 20 }, (_, index) => ({ name: 'first' + index,
    description: '测试', scopes: ['group'], priority: 'high' }))
  const waiting = { name: 'waiting', description: '测试', scopes: ['group'],
    onPanelResult(result) { results.push(result.approved) } }
  await synchronizer.synchronize([...commands, waiting])
  await synchronizer.synchronize([...commands.slice(1), waiting])
  assert.deepEqual(results, [false, true])
  assert.ok(bot.records[0].panel.items.some(item => item.name === 'waiting'))
  await synchronizer.synchronize([])
  assert.equal(bot.records.length, 0)
})

test('同步器按 QQ 字符计数规则截短过长的指令描述', async () => {
  const warnings = []
  const bot = createFakeBot()
  const synchronizer = new CommandPanelSynchronizer(bot, {
    info() {},
    warn(message) { warnings.push(message) },
  })
  await synchronizer.synchronize([{
    name: '长描述',
    description: '这是一个明显超过十五个中文字符的指令面板描述内容',
    scopes: ['group'],
  }])
  const panel = bot.records.find(record => record.scope === 'group')
  assert.ok(panel.panel.items[0].desc.endsWith('…'))
  assert.ok(panelTextUnits(panel.panel.items[0].desc) <= DESCRIPTION_MAX_UNITS)
  assert.match(warnings[0], /已截短/u)
})
