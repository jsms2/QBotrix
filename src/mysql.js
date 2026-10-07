// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const mysql2 = require('mysql2/promise')

const PUBLIC_TABLE_PREFIX = '_public_'
const FRAMEWORK_LOG_TABLE = '_framework_call_log'

function normalizePluginName(pluginName) {
  const normalized = String(pluginName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  if (!normalized) throw new TypeError('插件名称无法转换为 MySQL 表前缀')
  return normalized
}

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replaceAll('`', '``')}\``
}

function stripSqlValues(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/--[^\r\n]*/gu, ' ')
    .replace(/#[^\r\n]*/gu, ' ')
    .replace(/'(?:''|\\.|[^'])*'/gu, "''")
    .replace(/"(?:""|\\.|[^"])*"/gu, '""')
}

function extractTableNames(sql) {
  const source = stripSqlValues(sql)
  const tableSource = source
    .replace(/\bon\s+duplicate\s+key\s+update\b/giu, 'ON DUPLICATE KEY SET')
    .replace(/\bon\s+update\s+current_timestamp(?:\s*\(\s*\d+\s*\))?/giu, '')
  const identifier = '(`[^`]+`|[a-zA-Z0-9_$.-]+)'
  const patterns = [
    new RegExp(`\\b(?:from|join|update|into|references)\\s+${identifier}`, 'giu'),
    new RegExp(`\\b(?:create|alter|drop|truncate)\\s+table\\s+(?:if\\s+(?:not\\s+)?exists\\s+)?${identifier}`, 'giu'),
  ]
  const names = []
  for (const pattern of patterns) {
    for (const match of tableSource.matchAll(pattern)) names.push(match[1].replace(/^`|`$/gu, ''))
  }
  return { names, source }
}

function validatePluginSql(sql, prefixes) {
  const value = String(sql || '').trim()
  if (!value) throw new TypeError('SQL 不能为空')
  if (/;\s*\S/gu.test(value)) throw new Error('插件 MySQL 对象不允许执行多条 SQL')

  const { names, source } = extractTableNames(value)
  const operation = source.match(/^\s*([a-z]+)/iu)?.[1]?.toLowerCase()
  const allowedOperations = new Set(['select', 'insert', 'replace', 'update', 'delete', 'with', 'create', 'alter', 'drop', 'truncate'])
  if (!allowedOperations.has(operation)) throw new Error(`插件 MySQL 对象不允许执行 ${operation || '未知'} 操作`)
  if (/\b(?:create\s+(?!table\b)|drop\s+(?!table\b)|rename\s+table|lock\s+tables|load\s+data)\b/iu.test(source)) {
    throw new Error('插件 MySQL 对象只允许操作数据表')
  }
  const identifier = '(?:`[^`]+`|[a-zA-Z0-9_$.-]+)'
  if (new RegExp(`\\bfrom\\s+${identifier}(?:\\s+(?:as\\s+)?[a-zA-Z0-9_$-]+)?\\s*,`, 'iu').test(source)
    || new RegExp(`\\bupdate\\s+${identifier}\\s*,`, 'iu').test(source)
    || new RegExp(`\\b(?:drop|truncate)\\s+table\\s+${identifier}\\s*,`, 'iu').test(source)) {
    throw new Error('插件 MySQL 对象不允许使用逗号形式操作多个表，请使用 JOIN 或分开执行')
  }

  for (const name of names) {
    if (name.includes('.')) throw new Error(`插件不能跨数据库访问表：${name}`)
    if (!prefixes.some(prefix => name.startsWith(prefix))) {
      throw new Error(`插件无权访问数据表：${name}`)
    }
  }
  if (!names.length && operation !== 'select') throw new Error('无法识别插件 SQL 操作的数据表')
  return value
}

class ScopedMySql {
  constructor(service, pluginName, executor) {
    this.service = service
    this.pluginName = pluginName
    this.pluginTablePrefix = `_plugin_${normalizePluginName(pluginName)}_`
    this.publicTablePrefix = PUBLIC_TABLE_PREFIX
    this.executor = executor
    this.allowedPrefixes = [this.publicTablePrefix, this.pluginTablePrefix]
  }

  publicTable(suffix) {
    const value = String(suffix || '')
    if (!/^[a-z0-9_]+$/iu.test(value)) throw new TypeError('公共表后缀只能包含字母、数字和下划线')
    return quoteIdentifier(`${this.publicTablePrefix}${value}`)
  }

  pluginTable(suffix) {
    const value = String(suffix || '')
    if (!/^[a-z0-9_]+$/iu.test(value)) throw new TypeError('插件表后缀只能包含字母、数字和下划线')
    return quoteIdentifier(`${this.pluginTablePrefix}${value}`)
  }

  query(sql, values) {
    return this.service.run(this.executor, 'query', validatePluginSql(sql, this.allowedPrefixes), values)
  }

  execute(sql, values) {
    return this.service.run(this.executor, 'execute', validatePluginSql(sql, this.allowedPrefixes), values)
  }

  async transaction(callback) {
    if (typeof callback !== 'function') throw new TypeError('transaction 需要回调函数')
    if (this.service.transaction) return this.service.transaction(this.pluginName, callback)
    const pool = this.service.requirePool()
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const scoped = new ScopedMySql(this.service, this.pluginName, connection)
      const result = await callback(scoped)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
}

class MySqlService {
  constructor(options = {}) {
    this.options = options
    this.pool = options.pool || null
    this.ownsPool = !options.pool
    this.initialized = false
  }

  createPool() {
    const config = {
      host: this.options.host || process.env.QQBOT_MYSQL_HOST,
      port: Number(this.options.port || process.env.QQBOT_MYSQL_PORT || 3306),
      user: this.options.user || process.env.QQBOT_MYSQL_USER,
      password: this.options.password ?? process.env.QQBOT_MYSQL_PASSWORD,
      database: this.options.database || process.env.QQBOT_MYSQL_DATABASE,
    }
    if (!config.host || !config.user || config.password === undefined || !config.database) {
      throw new Error('请配置 QQBOT_MYSQL_HOST、QQBOT_MYSQL_USER、QQBOT_MYSQL_PASSWORD 和 QQBOT_MYSQL_DATABASE')
    }
    this.pool = mysql2.createPool({
      ...config,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: Number(this.options.connectionLimit || process.env.QQBOT_MYSQL_CONNECTION_LIMIT || 10),
      maxIdle: Number(this.options.maxIdle || process.env.QQBOT_MYSQL_MAX_IDLE || 10),
      idleTimeout: Number(this.options.idleTimeout || process.env.QQBOT_MYSQL_IDLE_TIMEOUT || 60000),
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      multipleStatements: false,
    })
    return this.pool
  }

  requirePool() {
    if (!this.pool) throw new Error('MySQL 服务尚未初始化')
    return this.pool
  }

  run(executor, method, sql, values) {
    const target = executor || this.requirePool()
    return target[method](sql, values)
  }

  async initialize() {
    if (this.initialized) return
    const pool = this.pool || this.createPool()
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(FRAMEWORK_LOG_TABLE)} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        correlation_id CHAR(36) NOT NULL,
        entry_type ENUM('user_call', 'bot_reply') NOT NULL,
        status ENUM('received', 'sent', 'failed') NOT NULL,
        scope VARCHAR(16) NOT NULL,
        plugin_name VARCHAR(191) NOT NULL,
        command_name VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NULL,
        group_id VARCHAR(191) NULL,
        message_id VARCHAR(191) NULL,
        content LONGTEXT NULL,
        details JSON NULL,
        error_message TEXT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_framework_call_log_correlation (correlation_id),
        KEY idx_framework_call_log_user_created (user_id, created_at),
        KEY idx_framework_call_log_command_created (command_name, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await pool.query('SELECT 1')
    this.initialized = true
  }

  forPlugin(pluginName) {
    return new ScopedMySql(this, pluginName)
  }

  executeFramework(sql, values) {
    return this.requirePool().execute(sql, values)
  }

  async close() {
    if (!this.pool) return
    const pool = this.pool
    this.pool = null
    this.initialized = false
    if (this.ownsPool) await pool.end()
  }
}

module.exports = {
  FRAMEWORK_LOG_TABLE,
  MySqlService,
  PUBLIC_TABLE_PREFIX,
  ScopedMySql,
  extractTableNames,
  normalizePluginName,
  validatePluginSql,
}
