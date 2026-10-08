// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { normalizeHttpUrl } = require('./temporary-image-host')

const DEFAULT_FRAMEWORK_CONFIG = Object.freeze({
  pluginDirectory: 'plugins',
  plugins: Object.freeze({ autoInstallDependencies: true }),
  logLevel: 'info',
  webHost: '127.0.0.1',
  webPort: 3000,
  imageHostMode: 'external',
  imageHostOrigin: '',
  imageUploadUrl: '',
  webPublicRoot: '',
  imageRetentionHours: 24,
})

function normalizeFrameworkConfig(input = {}) {
  if (input.plugins !== undefined && (!input.plugins || typeof input.plugins !== 'object' || Array.isArray(input.plugins))) {
    throw new TypeError('plugins 配置必须是对象')
  }
  const autoInstallDependencies = input.plugins?.autoInstallDependencies ?? true
  if (typeof autoInstallDependencies !== 'boolean') throw new TypeError('plugins.autoInstallDependencies 必须是布尔值')
  const webPort = Number(input.webPort ?? DEFAULT_FRAMEWORK_CONFIG.webPort)
  if (!Number.isInteger(webPort) || webPort < 0 || webPort > 65535) {
    throw new TypeError('Web 管理端口必须是 0 到 65535 之间的整数')
  }
  const imageHostMode = String(input.imageHostMode ?? 'external').trim()
  if (!['external', 'builtin'].includes(imageHostMode)) throw new TypeError('图床模式必须是 external 或 builtin')
  const imageRetentionHours = Number(input.imageRetentionHours ?? 24)
  if (!Number.isFinite(imageRetentionHours) || imageRetentionHours <= 0 || imageRetentionHours > 8760) {
    throw new TypeError('图片保留时间必须大于 0 且不超过 8760 小时')
  }
  return {
    pluginDirectory: String(input.pluginDirectory || DEFAULT_FRAMEWORK_CONFIG.pluginDirectory).trim(),
    plugins: { autoInstallDependencies },
    logLevel: String(input.logLevel || DEFAULT_FRAMEWORK_CONFIG.logLevel).trim(),
    webHost: String(input.webHost || DEFAULT_FRAMEWORK_CONFIG.webHost).trim(),
    webPort,
    imageHostMode,
    imageHostOrigin: normalizeHttpUrl(input.imageHostOrigin, '外部图床根地址', { root: true }),
    imageUploadUrl: normalizeHttpUrl(input.imageUploadUrl, '外部图床上传地址'),
    webPublicRoot: normalizeHttpUrl(input.webPublicRoot, '管理页面公网根地址', { root: true }),
    imageRetentionHours,
  }
}

class FrameworkConfigStore {
  constructor(filePath, defaults = {}) {
    this.filePath = path.resolve(filePath)
    this.defaults = normalizeFrameworkConfig({ ...DEFAULT_FRAMEWORK_CONFIG, ...defaults })
    this.value = this.defaults
  }

  async load() {
    try {
      const source = await fs.readFile(this.filePath, 'utf8')
      this.value = normalizeFrameworkConfig({ ...this.defaults, ...JSON.parse(source) })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.value = this.defaults
    }
    return this.get()
  }

  get() {
    return { ...this.value, plugins: { ...this.value.plugins } }
  }

  async update(patch) {
    this.value = normalizeFrameworkConfig({ ...this.value, ...patch })
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, this.filePath)
    return this.get()
  }
}

module.exports = { DEFAULT_FRAMEWORK_CONFIG, FrameworkConfigStore, normalizeFrameworkConfig }
