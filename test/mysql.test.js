// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { CallAuditLog } = require('../src/call-audit-log')
const { MySqlService, normalizePluginName, validatePluginSql } = require('../src/mysql')

test('MySQL 初始化只创建框架审计表，不创建插件业务表', async () => {
  const queries = []
  const service = new MySqlService({ pool: { async query(sql) { queries.push(sql); return [[], []] } } })
  await service.initialize()
  const tables = queries.filter(sql => /CREATE TABLE/iu.test(sql))
    .map(sql => sql.match(/CREATE TABLE IF NOT EXISTS\s+(\S+)/iu)[1].replaceAll('`', ''))
  assert.deepEqual(tables, ['_framework_call_log'])
  await service.close()
})

test('插件 MySQL 对象只允许公共表和自己的插件表', async () => {
  const executions = []
  const pool = {
    async execute(sql, values) {
      executions.push({ sql, values })
      return [[], []]
    },
  }
  const service = new MySqlService({ pool })
  const database = service.forPlugin('sample-plugin')

  assert.equal(normalizePluginName('sample-plugin'), 'sample_plugin')
  assert.equal(database.publicTable('cache'), '`_public_cache`')
  assert.equal(database.pluginTable('settings'), '`_plugin_sample_plugin_settings`')
  await database.execute('SELECT * FROM `_public_cache` WHERE id = ?', [1])
  await database.execute('UPDATE `_plugin_sample_plugin_settings` SET value = ? WHERE id = ?', ['x', 1])
  assert.equal(executions.length, 2)
  assert.throws(
    () => database.execute('SELECT * FROM `_plugin_other_settings`'),
    /无权访问数据表/u,
  )
  assert.throws(
    () => validatePluginSql('DROP DATABASE new_bot', database.allowedPrefixes),
    /不允许执行|只允许操作数据表/u,
  )
})

test('插件 SQL 权限解析允许 ON UPDATE 时间戳和 ON DUPLICATE KEY UPDATE', () => {
  assert.doesNotThrow(() => validatePluginSql(`
    CREATE TABLE IF NOT EXISTS \`_plugin_demo_settings\` (
      id INT PRIMARY KEY,
      updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    )
  `, ['_plugin_demo_']))
  assert.doesNotThrow(() => validatePluginSql(`
    INSERT INTO \`_plugin_demo_settings\` (id) VALUES (?)
    ON DUPLICATE KEY UPDATE updated_at = NOW(3)
  `, ['_plugin_demo_']))
})

test('插件 MySQL 事务提交并在失败时回滚', async () => {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async execute() { calls.push('execute'); return [[], []] },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
  }
  const service = new MySqlService({ pool: { async getConnection() { return connection } } })
  const database = service.forPlugin('example')
  await database.transaction(transaction => transaction.execute('SELECT * FROM `_public_cache`'))
  assert.deepEqual(calls, ['begin', 'execute', 'commit', 'release'])

  calls.length = 0
  await assert.rejects(database.transaction(async () => { throw new Error('失败') }), /失败/u)
  assert.deepEqual(calls, ['begin', 'rollback', 'release'])
})

test('调用审计把用户调用和机器人回复写入同一张表', async () => {
  const rows = []
  const database = {
    async executeFramework(sql, values) {
      rows.push({ sql, values })
      return [{ insertId: rows.length }, []]
    },
  }
  const audit = new CallAuditLog(database, { error() {} })
  const context = await audit.recordCall({
    scope: 'group',
    command: { pluginName: 'example', name: '测试' },
    args: '参数',
    event: {
      message_id: 'message-1',
      group_id: 'group-1',
      raw_message: '测试 参数',
      sender: { user_openid: 'user-1' },
    },
  })
  await audit.recordReply(context, {
    type: 'markdown',
    data: { content: '# 回复' },
  }, { id: 'reply-1' }, null)

  assert.equal(rows.length, 2)
  assert.match(rows[0].sql, /_framework_call_log/u)
  assert.match(rows[1].sql, /_framework_call_log/u)
  assert.equal(rows[0].values[1], 'group')
  assert.equal(rows[0].values[4], 'user-1')
  assert.equal(rows[1].values[8], '# 回复')
})
