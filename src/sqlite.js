// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { ScopedMySql, FRAMEWORK_LOG_TABLE } = require('./mysql')

// The plugin object retains its historical `mysql` name and mysql2 result shape.
function sqliteSql(source) {
  let sql = String(source)
  const upsertIndex = sql.search(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/iu)
  if (upsertIndex >= 0) {
    sql = sql.slice(0, upsertIndex) + sql.slice(upsertIndex)
      .replace(/\bVALUES\s*\(\s*(`?[a-z_][a-z_0-9]*`?)\s*\)/giu, 'excluded.$1')
  }
  sql = sql.replace(/\bFOR\s+UPDATE\b/giu, '')
    .replace(/^\s*TRUNCATE\s+(?:TABLE\s+)?(`?[a-z_][a-z_0-9]*`?)\s*;?\s*$/iu, 'DELETE FROM $1')
    .replace(/\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d+\s*\))?/giu, '')
    .replace(/\bNOW\s*\(\s*\d*\s*\)/giu, "strftime('%Y-%m-%d %H:%M:%f', 'now')")
    .replace(/\bCURRENT_TIMESTAMP\s*\(\s*\d+\s*\)/giu, "(strftime('%Y-%m-%d %H:%M:%f', 'now'))")
    .replace(/\bINSERT\s+IGNORE\s+INTO\b/giu, 'INSERT OR IGNORE INTO')
    .replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/giu, 'ON CONFLICT DO UPDATE SET')
  if (/^\s*CREATE\s+TABLE\b/iu.test(sql)) {
    sql = sql.replace(/\b(?:TINYINT|SMALLINT|MEDIUMINT|BIGINT|INT)\s+UNSIGNED\b/giu, 'INTEGER')
      .replace(/\bENUM\s*\((?:[^()]|'[^']*')*\)/giu, 'TEXT')
      .replace(/\bAUTO_INCREMENT\b/giu, 'AUTOINCREMENT')
      .replace(/\bUNIQUE\s+(?:KEY|INDEX)\s+`?[a-z_][a-z_0-9]*`?\s*(\([^)]*\))/giu, 'UNIQUE $1')
      .replace(/,\s*(?:KEY|INDEX)\s+`?[a-z_][a-z_0-9]*`?\s*\([^)]*\)/giu, '')
      .replace(/\)\s*ENGINE\s*=\s*\w+(?:\s+DEFAULT\s+CHARSET\s*=\s*\w+)?(?:\s+COLLATE\s*=\s*\w+)?\s*;?\s*$/iu, ')')
      .replace(/\s+CHARACTER\s+SET\s+\w+(?:\s+COLLATE\s+\w+)?/giu, '')
    const auto = sql.match(/\b(`?[a-z_][a-z_0-9]*`?)\s+(?:BIGINT|INT|INTEGER)\s+(?:UNSIGNED\s+)?(?:NOT\s+NULL\s+)?AUTOINCREMENT\b/iu)
    if (auto) {
      sql = sql.replace(auto[0], `${auto[1]} INTEGER PRIMARY KEY AUTOINCREMENT`)
        .replace(new RegExp(`,\\s*PRIMARY\\s+KEY\\s*\\(\\s*${auto[1]}\\s*\\)`, 'iu'), '')
    }
  }
  return sql
}

function sqliteValue(value) {
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '')
  if (typeof value === 'boolean') return Number(value)
  if (value === undefined) throw new TypeError('SQL 参数不能是 undefined')
  return value
}

class SqliteService {
  constructor(options = {}) {
    this.options = options
    this.database = null
    this.initialized = false
    this.queue = Promise.resolve()
  }

  requirePool() {
    if (!this.database) throw new Error('SQLite 服务尚未初始化')
    return this
  }

  enqueue(work) {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }

  perform(sql, values) {
    const statement = this.database.prepare(sqliteSql(sql))
    const parameters = (values || []).map(sqliteValue)
    const columns = statement.columns()
    if (columns.length) {
      const dateColumns = columns.filter(column => /^(?:DATE|DATETIME|TIMESTAMP)\b/iu.test(column.type || ''))
      const jsonColumns = columns.filter(column => /^JSON\b/iu.test(column.type || ''))
      const rows = statement.all(...parameters).map(row => {
        const item = { ...row }
        for (const column of dateColumns) {
          const value = item[column.name]
          if (typeof value === 'string') {
            const date = new Date(value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/u.test(value) ? '' : 'Z'))
            if (!Number.isNaN(date.getTime())) item[column.name] = date
          }
        }
        for (const column of jsonColumns) {
          const value = item[column.name]
          if (typeof value === 'string') item[column.name] = JSON.parse(value)
        }
        return item
      })
      return [rows, []]
    }
    const result = statement.run(...parameters)
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }, []]
  }

  run(executor, _method, sql, values) {
    if (executor) return Promise.resolve(this.perform(sql, values))
    return this.enqueue(() => this.perform(sql, values))
  }

  async transaction(pluginName, callback) {
    if (typeof callback !== 'function') throw new TypeError('transaction 需要回调函数')
    return this.enqueue(async () => {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        const result = await callback(new ScopedMySql(this, pluginName, this))
        this.database.exec('COMMIT')
        return result
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
    })
  }

  async initialize() {
    if (this.initialized) return
    const filePath = path.resolve(this.options.path || path.join(process.cwd(), 'data', 'qqbot.sqlite'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.database = new DatabaseSync(filePath)
    try {
      this.database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS \`${FRAMEWORK_LOG_TABLE}\` (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          correlation_id TEXT NOT NULL, entry_type TEXT NOT NULL, status TEXT NOT NULL,
          scope TEXT NOT NULL, plugin_name TEXT NOT NULL, command_name TEXT NOT NULL,
          user_id TEXT, group_id TEXT, message_id TEXT, content TEXT, details TEXT,
          error_message TEXT, created_at DATETIME(3) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_framework_call_log_correlation ON \`${FRAMEWORK_LOG_TABLE}\` (correlation_id);
        CREATE INDEX IF NOT EXISTS idx_framework_call_log_user_created ON \`${FRAMEWORK_LOG_TABLE}\` (user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_framework_call_log_command_created ON \`${FRAMEWORK_LOG_TABLE}\` (command_name, created_at);
      `)
      this.initialized = true
    } catch (error) {
      this.database.close()
      this.database = null
      throw error
    }
  }

  forPlugin(pluginName) {
    return new ScopedMySql(this, pluginName)
  }

  executeFramework(sql, values) {
    return this.run(null, 'execute', sql, values)
  }

  async close() {
    await this.queue
    this.database?.close()
    this.database = null
    this.initialized = false
  }
}

module.exports = { SqliteService, sqliteSql }
