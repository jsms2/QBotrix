// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Bot, ReceiverMode } = require('qq-official-bot')
const { QQBotPluginFramework } = require('./framework')
const { startConsole } = require('./console-control')
const { createLogger } = require('./logger')
const { FrameworkConfigStore } = require('./framework-config')

const projectRoot = path.resolve(__dirname, '..')
const envFile = path.join(projectRoot, '.env')
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile)

async function main() {
  const configStore = new FrameworkConfigStore(path.join(projectRoot, 'data', 'framework-config.json'))
  const config = await configStore.load()
  const logger = createLogger('qqbot')
  const appid = process.env.QQBOT_APPID?.trim()
  const secret = process.env.QQBOT_SECRET?.trim()
  if (!appid || !secret) throw new Error('请在 .env 中设置 QQBOT_APPID 和 QQBOT_SECRET')

  const bot = new Bot({
    appid,
    secret,
    intents: ['GROUP_AND_C2C_EVENT', 'GROUP_MEMBER', 'INTERACTION'],
    mode: ReceiverMode.WEBSOCKET,
    removeAt: true,
    logLevel: process.env.QQBOT_LOG_LEVEL || config.logLevel,
  })
  const framework = new QQBotPluginFramework(bot, {
    logger,
    baseDir: projectRoot,
    configStore,
    temporaryImageHostOptions: {
      mode: process.env.QQBOT_IMAGE_HOST_MODE,
      origin: process.env.QQBOT_IMAGE_HOST_ORIGIN,
      uploadUrl: process.env.QQBOT_IMAGE_UPLOAD_URL,
      publicRoot: process.env.QQBOT_WEB_PUBLIC_ROOT,
      retentionHours: process.env.QQBOT_IMAGE_RETENTION_HOURS,
      logger,
    },
    webAdminOptions: {
      host: process.env.QQBOT_WEB_HOST || config.webHost,
      port: process.env.QQBOT_WEB_PORT === undefined ? config.webPort : Number(process.env.QQBOT_WEB_PORT),
      token: process.env.QQBOT_WEB_TOKEN,
    },
  })
  await framework.initialize()
  framework.bind()

  let terminal
  let stopping = false
  const stop = async signal => {
    if (stopping) return
    stopping = true
    logger.info(`收到 ${signal}，正在关闭`)
    terminal?.close()
    await framework.close()
    await bot.stop()
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))

  try {
    await bot.start()
    const configuredPluginDirectory = process.env.QQBOT_PLUGIN_DIR || config.pluginDirectory
    const pluginDirectory = path.isAbsolute(configuredPluginDirectory)
      ? configuredPluginDirectory
      : path.resolve(projectRoot, configuredPluginDirectory)
    await framework.plugins.loadDirectory(pluginDirectory)
    await framework.startWebAdmin()
    logger.info(`机器人已启动，共加载 ${framework.plugins.listPlugins().length} 个插件`)
    if (process.stdin.isTTY && process.env.QQBOT_CONSOLE !== '0') {
      terminal = startConsole(framework.plugins, logger, projectRoot)
    }
  } catch (error) {
    await framework.close().catch(closeError => logger.error('启动失败后的框架清理也发生错误', closeError))
    await bot.stop().catch(() => undefined)
    throw error
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { main }
