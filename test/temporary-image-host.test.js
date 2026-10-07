// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { TemporaryImageHost, normalizeImage, parseUploadedImagePath } = require('../src/temporary-image-host')
const { normalizeFrameworkConfig, FrameworkConfigStore } = require('../src/framework-config')
const { QQBotPluginFramework } = require('../src/framework')
const { createImageHost } = require('../examples/external-image-host/node/server.cjs')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ZkAAAAASUVORK5CYII=', 'base64')
const token = 'image-test-token-12345678'
const logger = { info() {}, warn() {}, error() {} }

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qqbot-images-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

test('图床配置独立保存上传地址，验证模式、URL、保留时间', async t => {
  const root = await temporaryDirectory(t)
  const store = new FrameworkConfigStore(path.join(root, 'config.json'))
  await store.load()
  assert.equal(store.get().imageUploadUrl, '')
  await store.update({ imageHostMode: 'builtin', webPublicRoot: 'https://bot.example.com/', imageRetentionHours: 3 })
  const reopened = new FrameworkConfigStore(path.join(root, 'config.json'))
  await reopened.load()
  assert.equal(reopened.get().webPublicRoot, 'https://bot.example.com')
  assert.equal(reopened.get().imageHostMode, 'builtin')
  assert.equal(reopened.get().imageRetentionHours, 3)
  for (const patch of [{ imageHostMode: 'other' }, { imageUploadUrl: '/upload.php' }, { webPublicRoot: 'https://bot.example/?x=1' }, { imageHostOrigin: 'ftp://files.example' }, { imageRetentionHours: 0 }]) {
    assert.throws(() => normalizeFrameworkConfig(patch))
  }
})

test('外部上传使用完整配置地址，根路径前缀保留；不再猜测 upload.php', async () => {
  let call
  const host = new TemporaryImageHost({
    origin: 'https://images.example.com/prefix/', uploadUrl: 'https://upload.example.com/custom?key=value', token,
    fetchImpl: async (url, options) => { call = { url, options }; return new Response('/images/example.png', { status: 201 }) },
  })
  assert.equal(await host.upload(png, { contentType: 'image/png' }), 'https://images.example.com/prefix/images/example.png')
  assert.equal(call.url, 'https://upload.example.com/custom?key=value')
  assert.equal(call.options.headers.Authorization, `Bearer ${token}`)
  assert.deepEqual(Buffer.from(await call.options.body.get('image').arrayBuffer()), png)
  await assert.rejects(new TemporaryImageHost({ origin: 'https://images.example', token }).upload(png, { contentType: 'image/png' }), /同时配置根地址和上传地址/u)
  await assert.rejects(new TemporaryImageHost({ origin: 'https://images.example', uploadUrl: 'https://images.example/anything', token: ' ' }).upload(png, { contentType: 'image/png' }), /TOKEN/u)
  for (const invalid of ['https://evil.example/a.png', '//evil.example/a.png', '/images/../a.png', '{"url":"/images/a.png"}']) assert.throws(() => parseUploadedImagePath(invalid, 'https://images.example'))
})

test('PNG/JPEG 内容和 30 MiB 上限对所有输入生效，远程流超限中止', async () => {
  const boundaryImage = Buffer.alloc(30 * 1024 * 1024)
  png.copy(boundaryImage)
  assert.equal(normalizeImage(boundaryImage, { contentType: 'image/png' }).buffer.length, 30 * 1024 * 1024)
  assert.throws(() => normalizeImage(Buffer.from('not image'), { contentType: 'image/png' }), /无效/u)
  assert.throws(() => normalizeImage(png, { contentType: 'image/jpeg' }), /不一致/u)
  assert.throws(() => normalizeImage(Buffer.alloc(30 * 1024 * 1024 + 1), { contentType: 'image/png' }), /30 MiB/u)
  assert.throws(() => normalizeImage(`data:image/jpeg;base64,${png.toString('base64')}`), /不一致/u)
  let cancelled = false
  const host = new TemporaryImageHost({ fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), body: (async function * () {
    try { yield Buffer.alloc(30 * 1024 * 1024); yield Buffer.alloc(1); assert.fail('must stop reading') }
    finally { cancelled = true }
  })() }) })
  await assert.rejects(host.download('https://images.example/a.png'), /30 MiB/u)
  assert.equal(cancelled, true)
})

test('内置图床使用框架数据库，公开 GET/HEAD、管理鉴权、重启持久化、自动清理', async t => {
  let running
  t.after(() => running?.framework.close())
  const root = await temporaryDirectory(t)
  let now = Date.now()
  const databasePath = path.join(root, 'images.sqlite')
  async function start() {
    const framework = new QQBotPluginFramework(new EventEmitter(), {
      baseDir: root, logger, sqliteOptions: { path: databasePath },
      frameworkConfig: { imageHostMode: 'builtin', webPublicRoot: 'https://public.example/bot', imageRetentionHours: 1 },
      temporaryImageHostOptions: { now: () => now, cleanupIntervalMs: 20, token: '' },
      webAdminOptions: { host: '127.0.0.1', port: 0, token },
    })
    await framework.initialize()
    const address = await framework.startWebAdmin()
    return { framework, address }
  }
  running = await start()
  const imageUrl = await running.framework.uploadTemporaryImage(png, { contentType: 'image/png' })
  assert.match(imageUrl, /^https:\/\/public\.example\/bot\/images\/[a-f0-9]{32}\.png$/u)
  const imagePath = new URL(imageUrl).pathname.replace('/bot', '')
  let response = await fetch(running.address + imagePath)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  response = await fetch(running.address + imagePath, { method: 'HEAD' })
  assert.equal(response.headers.get('content-length'), String(png.length))
  assert.equal((await response.arrayBuffer()).byteLength, 0)
  assert.equal((await fetch(running.address + imagePath, { method: 'POST' })).status, 405)
  assert.equal((await fetch(running.address + '/images/invalid.png')).status, 404)
  assert.equal((await fetch(running.address + '/', { redirect: 'manual' })).status, 303)
  // Management form saves all five new fields, then config and blobs survive restart.
  response = await fetch(running.address + '/config', {
    method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ pluginDirectory: 'plugins', logLevel: 'info', webHost: '127.0.0.1', webPort: '0',
      imageHostMode: 'builtin', imageHostOrigin: '', imageUploadUrl: '', webPublicRoot: 'https://public.example/bot', imageRetentionHours: '1' }),
  })
  assert.equal(response.status, 303)
  await running.framework.close()
  running = await start()
  assert.equal((await fetch(running.address + imagePath)).status, 200)
  now += 3600001
  assert.equal((await fetch(running.address + imagePath)).status, 404)
  await new Promise(resolve => setTimeout(resolve, 80))
  const [rows] = await running.framework.mysql.executeFramework('SELECT COUNT(*) AS count FROM `_framework_temporary_images`')
  assert.equal(rows[0].count, 0)
})

test('内置图床未配置公网地址时给出可定位错误', async () => {
  await assert.rejects(new TemporaryImageHost({ mode: 'builtin' }).upload(png, { contentType: 'image/png' }), /QQBOT_WEB_PUBLIC_ROOT/u)
})

test('独立 Node 图床与框架上传协议互通，鉴权、大小、过期和自动清理', async t => {
  const storage = await temporaryDirectory(t)
  let now = Date.now()
  const service = await createImageHost({ storage, token, ttlSeconds: 1, cleanupSeconds: 0.02, now: () => now, logger })
  t.after(() => service.close())
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${service.server.address().port}`
  const host = new TemporaryImageHost({ origin, uploadUrl: `${origin}/upload`, token })
  const imageUrl = await host.upload(`data:image/png;base64,${png.toString('base64')}`)
  let response = await fetch(imageUrl)
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  assert.equal((await fetch(imageUrl, { method: 'HEAD' })).status, 200)
  // The upload size boundary is inclusive; also exercise multipart overhead.
  const boundaryImage = Buffer.alloc(30 * 1024 * 1024)
  png.copy(boundaryImage)
  png.subarray(-12).copy(boundaryImage, boundaryImage.length - 12)
  const largeImageUrl = await host.upload(boundaryImage, { contentType: 'image/png' })
  const largeImageHead = await fetch(largeImageUrl, { method: 'HEAD' })
  assert.equal(largeImageHead.status, 200)
  assert.equal(Number(largeImageHead.headers.get('content-length')), boundaryImage.length)
  assert.equal((await fetch(`${origin}/upload`, { method: 'POST' })).status, 401)
  assert.equal((await fetch(`${origin}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'invalid' })).status, 400)
  for (const [type, bytes, status] of [['image/png', Buffer.from('fake'), 415], ['image/png', Buffer.alloc(30 * 1024 * 1024 + 1), 413]]) {
    const form = new FormData(); form.append('image', new Blob([bytes], { type }), 'file.png')
    response = await fetch(`${origin}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
    assert.equal(response.status, status)
  }
  await fs.writeFile(path.join(storage, 'keep.txt'), 'other data')
  now += 1001
  assert.equal((await fetch(imageUrl)).status, 404)
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.deepEqual(await fs.readdir(storage), ['keep.txt'])
  // Startup cleanup also handles files left behind while the service was stopped.
  await service.close()
  await fs.writeFile(path.join(storage, `${now - 1}-${'a'.repeat(32)}.png`), png)
  const restarted = await createImageHost({ storage, token, now: () => now, logger })
  await restarted.close()
  assert.deepEqual(await fs.readdir(storage), ['keep.txt'])
})
