// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCommand } = require('../src/plugin-manager')
const { selectPanelCommands } = require('../src/command-panel-selection')

const command = (index, options = {}) => ({ name: 'cmd' + index, description: '测试', scopes: ['group'], ...options })

test('命令卡片选项兼容默认值，并拒绝错误配置', () => {
  const input = { ...command(0), handler() {} }
  const normalized = normalizeCommand(input, 'demo')
  assert.equal(normalized.inCommandPanel, true)
  assert.equal(normalized.priority, 'normal')
  assert.equal(normalized.required, false)
  for (const options of [{ priority: 'urgent' }, { priority: 1 }, { inCommandPanel: 'false' }, { required: 1 },
    { required: true, inCommandPanel: false }, { onPanelResult: true }]) {
    assert.throws(() => normalizeCommand({ ...input, ...options }, 'demo'), TypeError)
  }
})

test('少于或等于 20 个时全部保留，主动关闭卡片的命令不占名额', () => {
  for (const count of [0, 19, 20]) {
    const commands = Array.from({ length: count }, (_, index) => command(index))
    const hidden = command('hidden', { inCommandPanel: false })
    const result = selectPanelCommands([...commands, hidden])
    assert.deepEqual(result.selected, commands)
    assert.deepEqual(result.excluded, [])
  }
})

test('先保留必选，再按五级优先级及输入顺序选择 20 个，且不修改注册列表', () => {
  const ordinary = Array.from({ length: 18 }, (_, index) => command(index))
  const required = command('required', { required: true, priority: 'optional' })
  const critical = command('critical', { priority: 'critical' })
  const high = command('high', { priority: 'high' })
  const low = command('low', { priority: 'low' })
  const optional = command('optional', { priority: 'optional' })
  const commands = [...ordinary, optional, low, high, critical, required]
  const original = [...commands]
  const expected = [required, critical, high, ...ordinary.slice(0, 17)]
  for (let run = 0; run < 3; run++) assert.deepEqual(selectPanelCommands(commands).selected, expected)
  assert.deepEqual(commands, original)
  assert.deepEqual(selectPanelCommands(commands).excluded.map(item => [item.command.name, item.priority]),
    [['cmd17', 'normal'], ['cmdlow', 'low'], ['cmdoptional', 'optional']])
  assert.deepEqual(selectPanelCommands([optional, low, ordinary[0], high, critical]).selected,
    [critical, high, ordinary[0], low, optional])
})

test('必选占满名额时不会被更高优先级普通命令淘汰，超过上限报错', () => {
  const required = Array.from({ length: 20 }, (_, index) => command(index, { required: true, priority: 'optional' }))
  assert.deepEqual(selectPanelCommands([...required, command('critical', { priority: 'critical' })]).selected, required)
  assert.throws(() => selectPanelCommands([...required, command(20, { required: true })]), /required: true.*21.*20/u)
})
