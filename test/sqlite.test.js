// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDatabaseService } = require('../src/database')
const { MySqlService } = require('../src/mysql')
const { SqliteService } = require('../src/sqlite')

test('默认使用免配置 SQLite，也可选择 MySQL', () => {
  const sqlite = createDatabaseService({ baseDir: 'C:/qqbot-test' })
  assert.ok(sqlite instanceof SqliteService)
  assert.equal(sqlite.options.path, path.join('C:/qqbot-test', 'data', 'qqbot.sqlite'))
  assert.ok(createDatabaseService({ type: 'mysql' }) instanceof MySqlService)
  assert.throws(() => createDatabaseService({ type: 'unknown' }), /不支持的数据库类型/u)
})

test('SQLite 首次启动建库，插件 API 保持可用并在重启后保留数据', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-sqlite-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'nested', 'qqbot.sqlite')
  const options = { path: file }
  const service = new SqliteService(options)
  await service.initialize()
  assert.equal(fs.existsSync(file), true)
  const [tables] = await service.executeFramework("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  assert.deepEqual(tables.map(table => table.name), ['_framework_call_log'])
  const db = service.forPlugin('example')
  assert.equal(db.pluginTable('settings'), '`_plugin_example_settings`')
  await db.execute(`CREATE TABLE IF NOT EXISTS ${db.pluginTable('settings')} (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    value VARCHAR(191) NOT NULL,
    payload JSON,
    updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), KEY idx_settings_updated (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  const [insert] = await db.execute(`INSERT INTO ${db.pluginTable('settings')} (value) VALUES (?)`, ['first'])
  assert.equal(insert.affectedRows, 1)
  assert.equal(insert.insertId, 1)
  await db.execute(`INSERT INTO ${db.pluginTable('settings')} (id, value) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)`, [1, 'updated'])
  const [rows, fields] = await db.query(`SELECT * FROM ${db.pluginTable('settings')} WHERE id = ?`, [1])
  assert.equal(rows[0].value, 'updated')
  assert.ok(rows[0].updated_at instanceof Date)
  assert.deepEqual(fields, [])
  await db.execute(`UPDATE ${db.pluginTable('settings')} SET payload = ? WHERE id = ?`, ['{"active":true}', 1])
  assert.deepEqual((await db.query(`SELECT payload FROM ${db.pluginTable('settings')}`))[0][0].payload, { active: true })
  assert.throws(() => db.query('SELECT * FROM `_plugin_other_settings`'), /无权访问数据表/u)
  await service.executeFramework('INSERT INTO `_framework_call_log` (correlation_id, entry_type, status, scope, plugin_name, command_name) VALUES (?, ?, ?, ?, ?, ?)',
    ['id', 'user_call', 'received', 'c2c', 'example', 'test'])
  await service.close()

  const reopened = new SqliteService(options)
  await reopened.initialize()
  assert.equal((await reopened.forPlugin('example').query('SELECT value FROM `_plugin_example_settings`'))[0][0].value, 'updated')
  assert.equal((await reopened.executeFramework('SELECT COUNT(*) AS count FROM `_framework_call_log`'))[0][0].count, 1)
  await reopened.close()
})

test('SQLite 事务回滚并隔离并发插件操作', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-sqlite-tx-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const service = new SqliteService({ path: path.join(root, 'db.sqlite') })
  await service.initialize()
  const db = service.forPlugin('example')
  await db.execute('CREATE TABLE `_plugin_example_items` (id INT PRIMARY KEY)')
  await assert.rejects(db.transaction(async transaction => {
    await transaction.execute('INSERT INTO `_plugin_example_items` (id) VALUES (?)', [1])
    throw new Error('rollback')
  }), /rollback/u)
  assert.equal((await db.query('SELECT * FROM `_plugin_example_items`'))[0].length, 0)

  let release
  const gate = new Promise(resolve => { release = resolve })
  const transaction = db.transaction(async scoped => {
    await scoped.execute('INSERT INTO `_plugin_example_items` (id) VALUES (?)', [2])
    await gate
    assert.equal((await scoped.query('SELECT * FROM `_plugin_example_items`'))[0].length, 1)
  })
  const outside = db.execute('INSERT INTO `_plugin_example_items` (id) VALUES (?)', [3])
  release()
  await Promise.all([transaction, outside])
  assert.deepEqual((await db.query('SELECT id FROM `_plugin_example_items` ORDER BY id'))[0], [{ id: 2 }, { id: 3 }])
  await service.close()
})
