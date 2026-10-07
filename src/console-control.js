// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const path = require('node:path')
const readline = require('node:readline')

function startConsole(pluginManager, logger, baseDir = process.cwd()) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'qbotrix> ' })

  async function execute(line) {
    const [command, ...rest] = line.trim().split(/\s+/u)
    const argument = rest.join(' ')
    if (!command) return
    switch (command.toLowerCase()) {
      case 'plugins':
      case 'list':
        console.table(pluginManager.listPlugins())
        break
      case 'load':
        if (!argument) throw new Error('用法: load <插件路径>')
        await pluginManager.load(path.resolve(baseDir, argument))
        break
      case 'unload':
        if (!argument) throw new Error('用法: unload <插件名>')
        await pluginManager.unload(argument)
        break
      case 'reload':
        if (!argument) throw new Error('用法: reload <插件名>')
        await pluginManager.reload(argument)
        break
      case 'help':
        console.log('plugins | load <路径> | unload <插件名> | reload <插件名> | help')
        break
      default:
        throw new Error(`未知控制台命令: ${command}`)
    }
  }

  terminal.on('line', line => {
    void execute(line).catch(error => logger.error(error)).finally(() => terminal.prompt())
  })
  terminal.prompt()
  return terminal
}

module.exports = { startConsole }
