// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const http = require('node:http')
const crypto = require('node:crypto')

const MAX_BODY_BYTES = 1024 * 1024
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_FAILURES = 5

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function readBody(request, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求内容超过允许的大小'), { statusCode: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function readForm(request) {
  return new URLSearchParams(await readBody(request))
}

function sendHtml(response, statusCode, content, { interactive = false } = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Form POSTs need their same-origin Origin header for plugin source checks.
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      + (interactive ? "; script-src 'self'; connect-src 'self'; img-src 'self' https: http: data:" : ''),
  })
  response.end(content)
}

function redirect(response, location) {
  response.writeHead(303, { Location: location, 'Cache-Control': 'no-store' })
  response.end()
}

function layout(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark;--bg:#0b1020;--card:#151c31;--line:#2b3655;--text:#eef3ff;--muted:#a9b4ce;--accent:#6ea8fe;--danger:#ff7b88}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#0b1020,#111a31);color:var(--text);font:15px/1.6 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:32px 20px}h1,h2{line-height:1.25}a{color:var(--accent)}.card{background:rgba(21,28,49,.96);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0;box-shadow:0 12px 35px #0004}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted)}input,select,button{font:inherit;color:var(--text);background:#0f172b;border:1px solid var(--line);border-radius:8px;padding:9px 11px}input{min-width:220px}button{cursor:pointer;background:#244a86}button.danger{background:#702d3a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}code{background:#0d1427;padding:2px 6px;border-radius:5px}</style></head>
<body><main>${body}</main></body></html>`
}

function cookieValue(request, name) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

class WebAdminServer {
  constructor({ pluginManager, configStore, logger, host, port, token, temporaryImageHost }) {
    this.pluginManager = pluginManager
    this.configStore = configStore
    this.logger = logger
    this.temporaryImageHost = temporaryImageHost
    this.host = host || '127.0.0.1'
    this.port = Number(port ?? 3000)
    this.token = String(token || '')
    this.server = null
    this.sessions = new Map()
    this.loginFailures = new Map()
  }

  async start() {
    if (this.server) return this.address()
    if (this.token.length < 16) throw new Error('Web 管理页面必须配置至少 16 个字符的 QQBOT_WEB_TOKEN')
    this.server = http.createServer((request, response) => {
      void this.#handle(request, response).catch(error => {
        this.logger.error('Web 管理请求处理失败', error)
        if (!response.headersSent) sendHtml(response, error.statusCode || 500, layout('请求失败', `<h1>请求失败</h1><div class="card">${escapeHtml(error.message)}</div>`))
        else response.end()
      })
    })
    const server = this.server
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.port, this.host, resolve)
      })
    } catch (error) {
      if (this.server === server) this.server = null
      throw error
    }
    this.logger.info(`Web 管理页面已启动: ${this.address()}`)
    return this.address()
  }

  address() {
    const address = this.server?.address()
    const port = typeof address === 'object' && address ? address.port : this.port
    const host = ['0.0.0.0', '::'].includes(this.host) ? '127.0.0.1' : this.host
    const formattedHost = host.includes(':') ? `[${host}]` : host
    return `http://${formattedHost}:${port}`
  }

  async close() {
    this.sessions.clear()
    this.loginFailures.clear()
    if (!this.server) return
    const server = this.server
    this.server = null
    if (!server.listening) return
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }

  #authorized(request) {
    const bearer = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/iu)?.[1]
    if (bearer && secureEqual(bearer, this.token)) return true
    const sessionId = cookieValue(request, 'qqbot_admin_session')
    const expiresAt = this.sessions.get(sessionId)
    if (!expiresAt) return false
    if (expiresAt <= Date.now()) {
      this.sessions.delete(sessionId)
      return false
    }
    return true
  }

  #clientAddress(request) {
    return String(request.socket?.remoteAddress || 'unknown')
  }

  #loginAllowed(request) {
    const key = this.#clientAddress(request)
    const entry = this.loginFailures.get(key)
    if (!entry || Date.now() - entry.startedAt >= LOGIN_WINDOW_MS) {
      this.loginFailures.delete(key)
      return true
    }
    return entry.count < MAX_LOGIN_FAILURES
  }

  #recordLoginFailure(request) {
    const key = this.#clientAddress(request)
    const current = this.loginFailures.get(key)
    if (!current || Date.now() - current.startedAt >= LOGIN_WINDOW_MS) {
      this.loginFailures.set(key, { count: 1, startedAt: Date.now() })
    } else {
      current.count += 1
    }
  }

  async #handle(request, response) {
    const url = new URL(request.url, 'http://localhost')
    if (await this.temporaryImageHost?.serve?.(request, response, url.pathname)) return
    if (url.pathname === '/login' && request.method === 'GET') {
      return sendHtml(response, 200, layout('登录', '<h1>QBotrix 管理</h1><form class="card" method="post"><label>管理令牌 <input name="token" type="password" required></label> <button>登录</button></form>'))
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      if (!this.#loginAllowed(request)) {
        return sendHtml(response, 429, layout('登录受限', '<h1>尝试次数过多</h1><div class="card">请在 15 分钟后重试。</div>'))
      }
      const form = await readForm(request)
      if (!secureEqual(form.get('token'), this.token)) {
        this.#recordLoginFailure(request)
        return sendHtml(response, 403, layout('登录失败', '<h1>令牌错误</h1>'))
      }
      this.loginFailures.delete(this.#clientAddress(request))
      const sessionId = crypto.randomBytes(32).toString('hex')
      this.sessions.set(sessionId, Date.now() + SESSION_TTL_MS)
      response.setHeader('Set-Cookie', `qqbot_admin_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`)
      return redirect(response, '/')
    }
    if (!this.#authorized(request)) return redirect(response, '/login')

    if (url.pathname === '/logout' && request.method === 'POST') {
      const sessionId = cookieValue(request, 'qqbot_admin_session')
      if (sessionId) this.sessions.delete(sessionId)
      response.setHeader('Set-Cookie', 'qqbot_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
      return redirect(response, '/login')
    }

    if (url.pathname === '/' && request.method === 'GET') return this.#dashboard(response)
    if (url.pathname === '/plugins/load' && request.method === 'POST') {
      const form = await readForm(request)
      const pluginPath = String(form.get('path') || '').trim()
      if (!pluginPath) throw Object.assign(new Error('插件路径不能为空'), { statusCode: 400 })
      await this.pluginManager.load(pluginPath)
      return redirect(response, '/')
    }
    const actionMatch = url.pathname.match(/^\/plugins\/([^/]+)\/(reload|unload)$/u)
    if (actionMatch && request.method === 'POST') {
      const name = decodeURIComponent(actionMatch[1])
      await this.pluginManager[actionMatch[2]](name)
      return redirect(response, '/')
    }
    if (url.pathname === '/config' && request.method === 'POST') {
      const form = await readForm(request)
      await this.configStore.update({
        pluginDirectory: form.get('pluginDirectory'),
        logLevel: form.get('logLevel'),
        webHost: form.get('webHost'),
        webPort: form.get('webPort'),
        imageHostOrigin: form.get('imageHostOrigin'),
        imageHostMode: form.get('imageHostMode') ?? 'external',
        imageUploadUrl: form.get('imageUploadUrl'),
        webPublicRoot: form.get('webPublicRoot'),
        imageRetentionHours: form.get('imageRetentionHours') ?? 24,
      })
      return redirect(response, '/')
    }

    const pluginMatch = url.pathname.match(/^\/plugins\/([^/]+)(\/.*)?$/u)
    if (pluginMatch) {
      const page = this.pluginManager.getWebPage(decodeURIComponent(pluginMatch[1]))
      if (!page) return sendHtml(response, 404, layout('未找到', '<h1>插件页面不存在</h1>'))
      request.pluginPath = pluginMatch[2] || '/'
      request.pluginUrlPrefix = page.urlPrefix
      return page.handler(request, response, {
        escapeHtml,
        layout,
        readBody,
        readForm,
        redirect,
        sendHtml,
        url,
        urlPrefix: page.urlPrefix,
      })
    }
    return sendHtml(response, 404, layout('未找到', '<h1>页面不存在</h1>'))
  }

  #dashboard(response) {
    const plugins = this.pluginManager.listPlugins()
    const config = this.configStore.get()
    const rows = plugins.map(plugin => `<tr><td><strong>${escapeHtml(plugin.name)}</strong></td><td>${plugin.commandCount}</td><td>${plugin.configUrl ? `<a href="${escapeHtml(plugin.configUrl)}">配置</a>` : '<span class="muted">无</span>'}</td><td><form class="row" method="post" action="/plugins/${encodeURIComponent(plugin.name)}/reload"><button>重载</button></form><form class="row" method="post" action="/plugins/${encodeURIComponent(plugin.name)}/unload"><button class="danger">卸载</button></form></td></tr>`).join('')
    const content = `<div class="row"><h1>QBotrix 管理</h1><form method="post" action="/logout"><button>退出登录</button></form></div><p class="muted">运行地址：<code>${escapeHtml(this.address())}</code></p>
<section class="card"><h2>插件</h2><table><thead><tr><th>名称</th><th>命令数</th><th>页面</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="4">暂无插件</td></tr>'}</tbody></table>
<form class="row" method="post" action="/plugins/load"><input name="path" placeholder="插件路径" required><button>加载插件</button></form></section>
<section class="card"><h2>主框架配置</h2><p class="muted">保存后将在下次启动时完整生效；敏感凭据不会在网页中显示或保存。</p><form method="post" action="/config"><div class="grid">
<label>插件目录<br><input name="pluginDirectory" value="${escapeHtml(config.pluginDirectory)}" required></label>
<label>日志级别<br><input name="logLevel" value="${escapeHtml(config.logLevel)}" required></label>
<label>管理监听地址<br><input name="webHost" value="${escapeHtml(config.webHost)}" required></label>
<label>管理端口<br><input name="webPort" type="number" min="0" max="65535" value="${config.webPort}" required></label>
<label>临时图床模式<br><select name="imageHostMode"><option value="external"${config.imageHostMode !== 'builtin' ? ' selected' : ''}>外部图床</option><option value="builtin"${config.imageHostMode === 'builtin' ? ' selected' : ''}>内置图床</option></select></label>
<label>外部图床根地址<br><input name="imageHostOrigin" type="url" value="${escapeHtml(config.imageHostOrigin)}" placeholder="https://images.example.com"></label>
<label>外部图床上传地址<br><input name="imageUploadUrl" type="url" value="${escapeHtml(config.imageUploadUrl)}" placeholder="https://images.example.com/api/upload"></label>
<label>管理页面公网根地址（内置图床）<br><input name="webPublicRoot" type="url" value="${escapeHtml(config.webPublicRoot)}" placeholder="https://bot.example.com"></label>
<label>内置图片保留时间（小时）<br><input name="imageRetentionHours" type="number" min="0.001" max="8760" step="any" value="${config.imageRetentionHours ?? 24}"></label>
</div><p class="muted">外部图床需要填写根地址和完整上传地址，并在环境变量中设置上传 Token。内置图床需要填写 QQ 可访问的管理页面公网根地址，图片到期自动清理。环境变量优先于网页配置；修改后重启生效。</p><p><button>保存配置</button></p></form></section>`
    return sendHtml(response, 200, layout('QBotrix 管理', content))
  }
}

module.exports = { WebAdminServer, escapeHtml, layout, readBody, readForm, redirect, sendHtml }
