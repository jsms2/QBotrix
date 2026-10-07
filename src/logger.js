// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

function formatError(error) {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

function createLogger(prefix = 'framework') {
  const write = (level, values) => {
    const method = level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'
    console[method](`[${new Date().toISOString()}] [${prefix}] [${level.toUpperCase()}]`, ...values)
  }

  return {
    debug: (...values) => write('debug', values),
    info: (...values) => write('info', values),
    warn: (...values) => write('warn', values),
    error: (...values) => write('error', values.map(value => value instanceof Error ? formatError(value) : value)),
    child: name => createLogger(`${prefix}:${name}`),
  }
}

module.exports = { createLogger, formatError }
