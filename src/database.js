// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const path = require('node:path')
const { MySqlService } = require('./mysql')
const { SqliteService } = require('./sqlite')

function createDatabaseService({ type, baseDir = process.cwd(), mysqlOptions, sqliteOptions } = {}) {
  const selected = String(type || process.env.QQBOT_DATABASE_TYPE || 'sqlite').trim().toLowerCase()
  if (selected === 'mysql') return new MySqlService(mysqlOptions)
  if (selected === 'sqlite') {
    return new SqliteService({
      path: path.join(baseDir, 'data', 'qqbot.sqlite'),
      ...sqliteOptions,
    })
  }
  throw new Error(`不支持的数据库类型：${selected}（可选 sqlite 或 mysql）`)
}

module.exports = { createDatabaseService }
