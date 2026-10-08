// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const assert = require('node:assert/strict')
const { QQBotPluginFramework } = require('../src/framework')
const { createLogger } = require('../src/logger')

async function smoke() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qbotrix-smoke-'))
  const bot = new EventEmitter()
  const logger = createLogger('smoke')
  const framework = new QQBotPluginFramework(bot, {
    baseDir: root, logger, synchronizer: {async synchronize() {}},
    frameworkConfig: {plugins:{autoInstallDependencies:false}},
    webAdminOptions: {host:'127.0.0.1', port:0, token:'smoke-only-local-token-12345'},
  })
  try {
    await fs.mkdir(path.join(root, 'plugins', 'broken'), {recursive:true})
    await fs.writeFile(path.join(root, 'plugins', 'broken', 'package.json'), JSON.stringify({name:'broken', dependencies:{missing:'1.0.0'}}))
    await fs.writeFile(path.join(root, 'plugins', 'legacy.cjs'), `module.exports = {name:'legacy', setup({registerCommand}) {
      registerCommand({name:'smoke', description:'smoke', scopes:'c2c', handler: async (_args, reply) => reply('smoke-ok')})
    }}`)
    await framework.initialize()
    framework.bind()
    await framework.plugins.loadDirectory()
    assert.deepEqual(framework.plugins.listPlugins().map(plugin => plugin.name), ['legacy'])
    const origin = await framework.startWebAdmin()
    const page = await fetch(origin, {headers:{Authorization:'Bearer smoke-only-local-token-12345'}})
    assert.equal(page.status, 200)
    assert.match(await page.text(), /自动安装插件 npm 依赖/u)
    const replied = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('消息路由未完成')), 5000)
      bot.emit('message.private.friend', {id:'smoke-message', raw_message:'/smoke',
        async reply(message) {clearTimeout(timer); resolve(message); return {id:'smoke-reply'}}})
    })
    assert.ok(JSON.stringify(await replied).includes('smoke-ok'))
    await framework.plugins.reload('legacy')
    await framework.plugins.unload('legacy')
    logger.info('Smoke OK: SQLite、依赖失败跳过、旧插件、Web 鉴权、消息路由、重载与卸载')
  } finally {
    await framework.close()
    assert.equal(bot.listenerCount('message.private.friend'), 0)
    await fs.rm(root, {recursive:true, force:true})
  }
}

smoke().catch(error => { console.error(error); process.exitCode = 1 })
