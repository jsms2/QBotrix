// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const { randomBytes } = require('node:crypto')
const DEFAULT_IMAGE_HOST_ORIGIN = ''
const MAX_REMOTE_IMAGE_BYTES = 30 * 1024 * 1024
const IMAGE_TABLE = '`_framework_temporary_images`'

function normalizeHttpUrl(value, label, { root = false } = {}) {
  const source = String(value || '').trim()
  if (!source) return ''
  let url
  try { url = new URL(source) } catch { throw new TypeError(`${label}必须是完整的 HTTP/HTTPS 地址`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || (root && url.search)) {
    throw new TypeError(`${label}必须使用 HTTP/HTTPS，不能包含凭据、片段${root ? '或查询参数' : ''}`)
  }
  return root ? url.href.replace(/\/+$/u, '') : url.href
}

function validateImage(buffer) {
  if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片必须非空且不能超过 30 MiB')
  const png = buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
  if (!png && !jpeg) throw new Error('图片文件内容无效，只支持 PNG/JPEG')
  return png ? 'image/png' : 'image/jpeg'
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/iu)
  if (!match) throw new Error('图片不是受支持的 PNG/JPEG Base64 数据')
  const buffer = Buffer.from(match[2].replace(/\s+/gu, ''), 'base64')
  const contentType = validateImage(buffer)
  if ((match[1].toLowerCase() === 'png') !== (contentType === 'image/png')) throw new Error('图片类型与文件内容不一致')
  return {
    buffer,
    contentType,
    fileName: contentType === 'image/png' ? 'temporary-image.png' : 'temporary-image.jpg',
  }
}

function normalizeImage(image, options = {}) {
  if (Buffer.isBuffer(image)) {
    const contentType = String(options.contentType || '').toLowerCase()
    if (!['image/png', 'image/jpeg'].includes(contentType)) {
      throw new Error('上传 Buffer 时必须指定 image/png 或 image/jpeg contentType')
    }
    if (validateImage(image) !== contentType) throw new Error('图片类型与文件内容不一致')
    return {
      buffer: image,
      contentType,
      fileName: options.fileName || (contentType === 'image/png' ? 'temporary-image.png' : 'temporary-image.jpg'),
    }
  }
  const parsed = parseImageDataUrl(image)
  if (options.fileName) parsed.fileName = options.fileName
  return parsed
}

function parseUploadedImagePath(responseText, origin) {
  const relativePath = String(responseText || '').trim()
  if (!/^\/images\/[a-z0-9._-]+\.(?:png|jpe?g|gif|webp)$/iu.test(relativePath)) {
    throw new Error('临时图床没有返回有效的图片相对地址')
  }
  const root = normalizeHttpUrl(origin, '外部图床根地址', { root: true })
  if (!root) throw new Error('未配置外部图床根地址')
  return `${root}${relativePath}`
}

class TemporaryImageHost {
  constructor(options = {}) {
    this.overrides = options
    this.token = options.token || process.env.QQBOT_IMAGE_UPLOAD_TOKEN
    this.fetchImpl = options.fetchImpl || fetch
    this.timeout = options.timeout || 10000
    this.logger = options.logger || console
    this.now = options.now || Date.now
    this.pendingCleanup = Promise.resolve()
    this.configure({})
  }

  configure(config, database) {
    this.mode = this.overrides.mode ?? config.imageHostMode ?? 'external'
    if (!['external', 'builtin'].includes(this.mode)) throw new Error('图床模式必须是 external 或 builtin')
    this.origin = normalizeHttpUrl(this.overrides.origin ?? config.imageHostOrigin, '外部图床根地址', { root: true })
    this.uploadUrl = normalizeHttpUrl(this.overrides.uploadUrl ?? config.imageUploadUrl, '外部图床上传地址')
    this.publicRoot = normalizeHttpUrl(this.overrides.publicRoot ?? config.webPublicRoot, '管理页面公网根地址', { root: true })
    const hours = Number(this.overrides.retentionHours ?? config.imageRetentionHours ?? 24)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) throw new Error('图片保留时间必须大于 0 且不超过 8760 小时')
    this.retentionMs = hours * 3600000
    this.database = database || this.overrides.database || this.database
  }

  async initialize() {
    if (this.mode !== 'builtin') return
    if (!this.database) throw new Error('内置图床需要框架数据库')
    await this.database.executeFramework(`CREATE TABLE IF NOT EXISTS ${IMAGE_TABLE} (
      name VARCHAR(40) PRIMARY KEY, content_type VARCHAR(32) NOT NULL,
      content LONGBLOB NOT NULL, expires_at BIGINT NOT NULL
    )`)
    await this.cleanup()
    clearInterval(this.cleanupTimer)
    this.cleanupTimer = setInterval(() => {
      this.pendingCleanup = this.cleanup().catch(error => this.logger.error('内置图床清理失败', error))
    }, this.overrides.cleanupIntervalMs || 600000)
    this.cleanupTimer.unref()
    this.initialized = true
  }

  cleanup() {
    return this.database.executeFramework(`DELETE FROM ${IMAGE_TABLE} WHERE expires_at <= ?`, [this.now()])
  }

  async close() {
    clearInterval(this.cleanupTimer)
    await this.pendingCleanup
    this.initialized = false
  }

  async serve(request, response, pathname) {
    if (this.mode !== 'builtin' || !pathname.startsWith('/images/')) return false
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return true
    }
    const name = pathname.slice('/images/'.length)
    let image
    if (/^[a-f0-9]{32}\.(?:png|jpg)$/u.test(name) && this.initialized) {
      const [rows] = await this.database.executeFramework(`SELECT content_type, content, expires_at FROM ${IMAGE_TABLE} WHERE name = ? AND expires_at > ?`, [name, this.now()])
      image = rows[0]
    }
    if (!image) { response.writeHead(404); response.end(); return true }
    const buffer = Buffer.from(image.content)
    response.writeHead(200, { 'Content-Type': image.content_type, 'Content-Length': buffer.length })
    response.end(request.method === 'HEAD' ? undefined : buffer)
    return true
  }

  async download(imageUrl, options = {}) {
    let url
    try {
      url = new URL(imageUrl)
    } catch {
      throw new Error('远程图片地址无效')
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('远程图片地址只支持 HTTP/HTTPS')

    const response = await (options.fetchImpl || this.fetchImpl)(url.href, {
      headers: {
        Accept: 'image/png,image/jpeg',
        'User-Agent': 'QBotrix/temporary-image-host',
      },
      signal: AbortSignal.timeout(options.timeout || this.timeout),
    })
    if (!response.ok) throw new Error(`远程图片下载失败（HTTP ${response.status}）`)

    const contentLength = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error('远程图片超过 30 MiB')
    }
    const contentType = String(response.headers?.get?.('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
    const chunks = []
    let size = 0
    if (response.body?.[Symbol.asyncIterator]) {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_REMOTE_IMAGE_BYTES) throw new Error('远程图片超过 30 MiB')
        chunks.push(Buffer.from(chunk))
      }
    } else chunks.push(Buffer.from(await response.arrayBuffer()))
    const buffer = Buffer.concat(chunks)
    if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error('远程图片超过 30 MiB')
    return normalizeImage(buffer, {
      ...options,
      contentType: options.contentType || contentType,
    })
  }

  async upload(image, options = {}) {
    if (this.mode === 'builtin') {
      if (!this.publicRoot) throw new Error('内置图床未配置管理页面公网根地址（QQBOT_WEB_PUBLIC_ROOT）')
      if (!this.initialized) throw new Error('内置图床尚未初始化')
    } else {
      if (!this.origin || !this.uploadUrl) throw new Error('外部图床必须同时配置根地址和上传地址（QQBOT_IMAGE_HOST_ORIGIN / QQBOT_IMAGE_UPLOAD_URL）')
      if (!String(options.token || this.token || '').trim()) throw new Error('未配置 QQBOT_IMAGE_UPLOAD_TOKEN')
    }

    const normalized = typeof image === 'string' && /^https?:\/\//iu.test(image)
      ? await this.download(image, options)
      : normalizeImage(image, options)
    if (this.mode === 'builtin') {
      const name = `${randomBytes(16).toString('hex')}.${normalized.contentType === 'image/png' ? 'png' : 'jpg'}`
      await this.database.executeFramework(`INSERT INTO ${IMAGE_TABLE} (name, content_type, content, expires_at) VALUES (?, ?, ?, ?)`,
        [name, normalized.contentType, normalized.buffer, this.now() + this.retentionMs])
      return `${this.publicRoot}/images/${name}`
    }
    const token = String(options.token || this.token || '').trim()
    const form = new FormData()
    form.append(
      'image',
      new Blob([normalized.buffer], { type: normalized.contentType }),
      normalized.fileName,
    )
    const response = await (options.fetchImpl || this.fetchImpl)(this.uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(options.timeout || this.timeout),
    })
    const responseText = await response.text()
    if (!response.ok) throw new Error(`临时图床上传失败（HTTP ${response.status}）`)
    return parseUploadedImagePath(responseText, this.origin)
  }
}

module.exports = {
  DEFAULT_IMAGE_HOST_ORIGIN,
  TemporaryImageHost,
  normalizeImage,
  parseImageDataUrl,
  parseUploadedImagePath,
  normalizeHttpUrl,
}
