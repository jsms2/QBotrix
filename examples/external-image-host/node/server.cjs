// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

// Standalone Node.js 22.13+ server; no npm dependencies or framework imports.
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 1024 * 1024
const FILE_PATTERN = /^(\d{13})-[a-f0-9]{32}\.(png|jpg)$/u

function positiveNumber(value, fallback, max) {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number) || number <= 0 || number > max) throw new Error('Invalid TTL/cleanup interval')
  return number
}

function imageType(buffer, declared) {
  const png = buffer.length >= 45 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && buffer.toString('ascii', 12, 16) === 'IHDR'
    && buffer.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
  const jpeg = buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer.at(-2) === 255 && buffer.at(-1) === 217
  const type = png ? 'image/png' : jpeg ? 'image/jpeg' : ''
  if (!type || type !== declared) throw Object.assign(new Error('Only PNG/JPEG with matching MIME and file signature are allowed'), { status: 415 })
  return type
}

function readBoundedBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        reject(Object.assign(new Error('Request exceeds 31 MiB'), { status: 413 }))
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
    request.on('aborted', () => reject(new Error('Request aborted')))
  })
}

async function createImageHost(options = {}) {
  const token = String(options.token ?? process.env.IMAGE_UPLOAD_TOKEN ?? '')
  if (token.length < 16) throw new Error('IMAGE_UPLOAD_TOKEN must contain at least 16 characters')
  const ttlMs = positiveNumber(options.ttlSeconds ?? process.env.IMAGE_TTL_SECONDS, 86400, 31536000) * 1000
  const intervalMs = positiveNumber(options.cleanupSeconds ?? process.env.CLEANUP_INTERVAL_SECONDS, 600, 86400) * 1000
  const storage = path.resolve(options.storage ?? process.env.IMAGE_STORAGE_DIR ?? path.join(__dirname, 'storage'))
  const now = options.now || Date.now
  const logger = options.logger || console
  await fs.mkdir(storage, { recursive: true, mode: 0o700 })

  async function cleanup() {
    const entries = await fs.readdir(storage, { withFileTypes: true })
    for (const entry of entries) {
      const match = FILE_PATTERN.exec(entry.name)
      if (!match || !entry.isFile() || Number(match[1]) > now()) continue
      await fs.unlink(path.join(storage, entry.name)).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }
  await cleanup()
  let pendingCleanup = Promise.resolve()
  const timer = setInterval(() => {
    pendingCleanup = pendingCleanup.then(cleanup).catch(error => logger.error('Image cleanup failed', error))
  }, intervalMs)
  timer.unref()

  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 30000 }, (request, response) => {
    void handle(request, response).catch(error => {
      if (!response.headersSent) {
        response.writeHead(error.status || 500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(error.status ? error.message : 'Internal server error')
      } else response.end()
      if (!error.status) logger.error('Image request failed', error)
    })
  })

  async function handle(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/upload' && request.method === 'POST') {
      const supplied = Buffer.from(String(request.headers.authorization || '').match(/^Bearer (.+)$/u)?.[1] || '')
      const expected = Buffer.from(token)
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        request.resume()
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
      }
      if (!/^multipart\/form-data;\s*boundary=/iu.test(request.headers['content-type'] || '')) {
        throw Object.assign(new Error('Expected multipart/form-data'), { status: 400 })
      }
      if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
        request.resume()
        throw Object.assign(new Error('Request exceeds 31 MiB'), { status: 413 })
      }
      const body = await readBoundedBody(request)
      let form
      try { form = await new Request('http://localhost/upload', { method: 'POST', headers: request.headers, body }).formData() }
      catch { throw Object.assign(new Error('Invalid multipart body'), { status: 400 }) }
      const entries = [...form.entries()]
      const image = form.get('image')
      if (entries.length !== 1 || !(image instanceof File)) throw Object.assign(new Error('Exactly one image file is required'), { status: 400 })
      if (!image.size || image.size > MAX_IMAGE_BYTES) throw Object.assign(new Error('Image must be nonempty and at most 30 MiB'), { status: 413 })
      const buffer = Buffer.from(await image.arrayBuffer())
      const type = imageType(buffer, image.type)
      const name = `${Math.floor(now() + ttlMs)}-${crypto.randomBytes(16).toString('hex')}.${type === 'image/png' ? 'png' : 'jpg'}`
      await fs.writeFile(path.join(storage, name), buffer, { flag: 'wx', mode: 0o600 })
      response.writeHead(201, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(`/images/${name}`)
      return
    }
    if (pathname.startsWith('/images/')) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return
      }
      const name = pathname.slice(8)
      const match = FILE_PATTERN.exec(name)
      if (match && Number(match[1]) > now()) {
        const filePath = path.join(storage, name)
        try {
          const stat = await fs.lstat(filePath)
          if (stat.isFile() && !stat.isSymbolicLink()) {
            const buffer = await fs.readFile(filePath)
            response.writeHead(200, { 'Content-Type': match[2] === 'png' ? 'image/png' : 'image/jpeg', 'Content-Length': buffer.length })
            response.end(request.method === 'HEAD' ? undefined : buffer)
            return
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      response.writeHead(404); response.end(); return
    }
    response.writeHead(pathname === '/upload' ? 405 : 404, pathname === '/upload' ? { Allow: 'POST' } : {})
    response.end()
  }

  async function close() {
    clearInterval(timer)
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await pendingCleanup
  }
  return { server, cleanup, close, storage }
}

if (require.main === module) {
  void createImageHost().then(service => {
    const host = process.env.IMAGE_HOST || '127.0.0.1'
    const port = Number(process.env.IMAGE_PORT || 8081)
    service.server.once('error', error => { console.error(error); void service.close(); process.exitCode = 1 })
    service.server.listen(port, host, () => console.log(`Image host listening on ${host}:${port}`))
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void service.close())
  }).catch(error => { console.error(error); process.exitCode = 1 })
}

module.exports = { createImageHost }
