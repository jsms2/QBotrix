// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { WebAdminServer } = require('../src/web-admin')

function silentLogger() {
  return { info() {}, error() {} }
}

test('Web 管理页鉴权并代理插件子配置页面和重载操作', async t => {
  const adminToken = 'secret-token-123456789'
  const calls = []
  const pluginManager = {
    listPlugins: () => [{ name: 'demo', commandCount: 1, configUrl: '/plugins/demo' }],
    getWebPage: name => name === 'demo' ? {
      urlPrefix: '/plugins/demo',
      handler(_request, response, tools) {
        tools.sendHtml(response, 200, tools.layout('Demo', '<h1>插件配置</h1>'))
      },
    } : undefined,
    async reload(name) { calls.push(['reload', name]) },
    async unload(name) { calls.push(['unload', name]) },
    async load(path) { calls.push(['load', path]) },
  }
  const configStore = {
    get: () => ({
      pluginDirectory: 'plugins', logLevel: 'info', webHost: '127.0.0.1', webPort: 0,
      imageHostOrigin: 'https://images.example',
    }),
    async update(value) { calls.push(['config', value]) },
  }
  const server = new WebAdminServer({
    pluginManager, configStore, logger: silentLogger(), host: '127.0.0.1', port: 0, token: adminToken,
  })
  t.after(() => server.close())
  const origin = await server.start()

  const unauthorized = await fetch(`${origin}/`, { redirect: 'manual' })
  assert.equal(unauthorized.status, 303)
  assert.equal(unauthorized.headers.get('location'), '/login')

  const login = await fetch(`${origin}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: adminToken }),
  })
  const cookie = login.headers.get('set-cookie').split(';', 1)[0]
  assert.doesNotMatch(cookie, new RegExp(adminToken, 'u'))
  const page = await fetch(`${origin}/plugins/demo/`, { headers: { Cookie: cookie } })
  assert.match(await page.text(), /插件配置/u)

  const reload = await fetch(`${origin}/plugins/demo/reload`, {
    method: 'POST', redirect: 'manual', headers: { Cookie: cookie },
  })
  assert.equal(reload.status, 303)
  assert.deepEqual(calls, [['reload', 'demo']])
})

test('Web 管理端口被占用时保留原始错误且可以安全清理', async t => {
  const occupied = http.createServer()
  await new Promise((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => occupied.close(resolve)))
  const port = occupied.address().port
  const server = new WebAdminServer({
    pluginManager: {},
    configStore: {},
    logger: silentLogger(),
    host: '127.0.0.1',
    port,
    token: 'another-secret-token-1234',
  })

  await assert.rejects(server.start(), error => error.code === 'EADDRINUSE')
  await assert.doesNotReject(server.close())
})

test('Web 管理页即使只监听本机也强制配置足够长的令牌', async () => {
  const server = new WebAdminServer({
    pluginManager: {}, configStore: {}, logger: silentLogger(), host: '127.0.0.1', port: 0,
  })
  await assert.rejects(server.start(), /至少 16 个字符的 QQBOT_WEB_TOKEN/u)
  await assert.doesNotReject(server.close())
})
