// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')

const STATE_FILE = '.qbotrix-dependencies.json'
// Shared by managers in this process; real paths also cover aliases and symlinks.
const pendingChecks = new Map()
const runtime = `${process.platform}/${process.arch}/${process.versions.modules}`

class PluginDependencyError extends Error {
  constructor(name, directory, operation, reason) {
    super(`插件 ${name} (${directory})：${operation} 失败；${reason}`)
    this.name = 'PluginDependencyError'
  }
}

async function readOptional(file) {
  try { return await fs.readFile(file, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function parseObject(source, label) {
  let value
  try { value = JSON.parse(source) }
  catch { throw new Error(`${label} 不是合法 JSON`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`)
  return value
}

async function readMetadata(directory) {
  const source = await readOptional(path.join(directory, 'package.json'))
  if (source === null) return { directory }
  const manifest = parseObject(source, 'package.json')
  const required = { ...manifest.dependencies }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const dependencies = manifest[field]
    if (dependencies === undefined) continue
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new Error(`package.json 的 ${field} 必须是对象`)
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu.test(name) || name.split('/').some(part => part === '.' || part === '..')
        || typeof version !== 'string' || !version.trim()) throw new Error(`package.json 的 ${field} 包含无效依赖声明`)
    }
  }
  for (const name of Object.keys(manifest.optionalDependencies || {})) delete required[name]
  for (const [name, version] of Object.entries(manifest.peerDependencies || {})) {
    if (!manifest.peerDependenciesMeta?.[name]?.optional) required[name] ??= version
  }
  const hasDependencies = ['dependencies', 'optionalDependencies', 'peerDependencies']
    .some(field => Object.keys(manifest[field] || {}).length)
  if (!hasDependencies) return { directory, manifest, source, required, hasDependencies: false }
  // npm-shrinkwrap takes precedence over package-lock in npm itself.
  if (await readOptional(path.join(directory, 'npm-shrinkwrap.json')) !== null) {
    throw new Error('不支持 npm-shrinkwrap.json，请使用插件自己的 package-lock.json')
  }
  const lockSource = await readOptional(path.join(directory, 'package-lock.json'))
  const lock = lockSource === null ? null : parseObject(lockSource, 'package-lock.json')
  if (lock && (![1, 2, 3].includes(lock.lockfileVersion)
    || (lock.lockfileVersion > 1 && (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)))
    || (lock.lockfileVersion === 1 && (!lock.dependencies || typeof lock.dependencies !== 'object')))) {
    throw new Error('package-lock.json 结构无效，请重新生成锁文件')
  }
  const dependencyHash = createHash('sha256').update(JSON.stringify([source, lockSource])).digest('hex')
  return { directory, manifest, source, required, hasDependencies, lock, lockSource, dependencyHash }
}

async function installedCompletely(metadata) {
  const { directory, required, lock } = metadata
  const modules = path.join(directory, 'node_modules')
  try {
    if (!(await fs.stat(modules)).isDirectory() || (await fs.lstat(modules)).isSymbolicLink()) return false
    const packages = new Map(Object.keys(required).map(name => [`node_modules/${name}`, null]))
    for (const [key, entry] of Object.entries(lock?.packages || {})) {
      const details = entry.link ? lock.packages[entry.resolved] || entry : entry
      if (!key.startsWith('node_modules/') || details.dev || details.optional || details.devOptional) continue
      const relative = path.relative(modules, path.resolve(directory, key))
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false
      packages.set(key, details)
    }
    for (const [key, entry] of packages) {
      const packageRoot = path.join(directory, key)
      const installed = parseObject(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'), '已安装依赖')
      const lockedVersion = entry?.version || lock?.dependencies?.[key.slice('node_modules/'.length)]?.version
      if (lockedVersion && installed.version !== lockedVersion) return false
      function exportTargets(value) {
        if (typeof value === 'string') return value.startsWith('./') && !value.includes('*') ? [value] : []
        if (!value || typeof value !== 'object') return []
        if (!Array.isArray(value) && Object.keys(value).some(name => name.startsWith('.'))) return exportTargets(value['.'])
        return Object.entries(value).filter(([condition]) => condition !== 'types').flatMap(([, target]) => exportTargets(target))
      }
      for (const target of exportTargets(installed.exports)) {
        if (!(await fs.stat(path.resolve(packageRoot, target))).isFile()) return false
      }
      if (installed.main && !installed.exports) {
        const main = path.resolve(packageRoot, installed.main)
        // Match Node's legacy main-file extension/directory fallback without resolving from ancestors.
        const candidates = [main, `${main}.js`, `${main}.json`, `${main}.node`, path.join(main, 'index.js'), path.join(packageRoot, 'index.js')]
        let found = false
        for (const file of candidates) {
          try { if ((await fs.stat(file)).isFile()) { found = true; break } } catch {}
        }
        if (!found) return false
      }
    }
    return true
  } catch { return false }
}

async function saveState(directory, state) {
  const file = path.join(directory, STATE_FILE)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporary, file)
  } finally { await fs.unlink(temporary).catch(() => {}) }
}

async function npmCommand({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command: 'npm', prefix: [] }
  // .cmd files cannot be spawned with shell:false. Locate npm.cmd, then execute
  // its companion npm-cli.js with Node, keeping spaces and metacharacters inert.
  const environmentPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const directory of environmentPath.split(';').filter(Boolean)) {
    const root = directory.replace(/^"|"$/gu, '')
    try {
      await fs.access(path.join(root, 'npm.cmd'))
      const cli = path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      await fs.access(cli)
      return { command: process.execPath, prefix: [cli] }
    } catch {}
  }
  if (env.npm_execpath && path.basename(env.npm_execpath) === 'npm-cli.js') {
    await fs.access(env.npm_execpath)
    return { command: process.execPath, prefix: [env.npm_execpath] }
  }
  throw Object.assign(new Error('未找到 npm.cmd 及 npm-cli.js，请安装或修复 Node.js/npm 并检查 PATH'), { code: 'ENOENT' })
}

async function runNpm(directory, args, { spawnImpl = spawn, ...commandOptions } = {}) {
  const { command, prefix } = await npmCommand(commandOptions)
  const env = commandOptions.env || process.env
  return new Promise((resolve, reject) => {
    let output = ''
    const child = spawnImpl(command, [...prefix, ...args], {
      cwd: directory, shell: false, windowsHide: true,
      env: { ...env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_workspaces: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const collect = chunk => { output = (output + chunk.toString()).slice(-16384) }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    // Never forward subprocess output: install scripts may print secrets.
    child.once('error', error => reject(new Error(`npm 无法启动 (${error.code || 'UNKNOWN'})，请检查 Node.js/npm、PATH 和权限`)))
    child.once('close', (code, signal) => {
      if (code === 0 && !signal) return resolve()
      const npmCode = output.match(/npm (?:error|ERR!) code ([A-Z][A-Z0-9_]{1,40})\b/u)?.[1]
      reject(new Error(`npm ${signal ? `被信号 ${signal} 终止` : `退出码 ${code}`}${npmCode ? ` (${npmCode})` : ''}；请检查网络、锁文件、磁盘空间、权限和安装脚本`))
    })
  })
}

class PluginDependencyManager {
  constructor({ logger, autoInstallDependencies = true, runNpm: runner = runNpm, baseDir } = {}) {
    this.logger = logger
    this.autoInstallDependencies = autoInstallDependencies
    this.runNpm = runner
    this.baseDir = baseDir && path.resolve(baseDir)
  }

  async ensure(pluginPath) {
    let directory = path.resolve(pluginPath)
    try {
      const stat = await fs.stat(directory)
      if (!stat.isDirectory()) directory = path.dirname(directory)
      directory = await fs.realpath(directory)
    } catch (error) {
      throw new PluginDependencyError(path.basename(directory), directory, '检查插件目录', error.code || '目录不可用')
    }
    // A loose file in the framework root must never install framework dependencies.
    if (directory === this.baseDir) return { directory }
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory
    if (pendingChecks.has(key)) return pendingChecks.get(key)
    const task = this.#ensure(directory)
    pendingChecks.set(key, task)
    try { return await task }
    finally { if (pendingChecks.get(key) === task) pendingChecks.delete(key) }
  }

  async #ensure(directory) {
    let name = path.basename(directory)
    let operation = '检查插件依赖'
    let metadata
    try {
      metadata = await readMetadata(directory)
      name = metadata.manifest?.name || name
      if (!metadata.hasDependencies) return metadata
      try {
        if ((await fs.lstat(path.join(directory, 'node_modules'))).isSymbolicLink()) {
          throw new Error('插件 node_modules 不可链接到共享目录，请为插件创建独立依赖目录')
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      let state
      try { state = JSON.parse(await readOptional(path.join(directory, STATE_FILE))) } catch {}
      const complete = await installedCompletely(metadata)
      if (state?.success && state.schemaVersion === 1 && state.runtime === runtime
        && state.dependencyHash === metadata.dependencyHash && complete) return metadata
      const args = [metadata.lock ? 'ci' : 'install', '--omit=dev']
      operation = `npm ${args.join(' ')}`
      if (!this.autoInstallDependencies) {
        // Allow an explicit manual installation to establish/refresh the state.
        operation = '检查插件依赖（自动安装已关闭）'
        if (!complete) throw new Error('自动依赖安装已关闭或依赖不完整')
        operation = 'npm ls --omit=dev --depth=0'
        await this.runNpm(directory, ['ls', '--omit=dev', '--depth=0'])
        await saveState(directory, { schemaVersion: 1, dependencyHash: metadata.dependencyHash, runtime,
          installedAt: new Date().toISOString(), success: true })
        return { ...metadata, refreshCache: true }
      }
      this.logger?.info(`插件 ${name} (${directory}) 需要安装依赖，执行 ${operation}`)
      this.logger?.warn(`仅应安装可信来源的插件：${name} 的 npm 安装脚本将以机器人进程权限执行`)
      await saveState(directory, { schemaVersion: 1, dependencyHash: metadata.dependencyHash, runtime, success: false })
      await this.runNpm(directory, args)
      const installed = await readMetadata(directory)
      if (installed.source !== metadata.source || (metadata.lockSource !== null && installed.lockSource !== metadata.lockSource)) {
        throw new Error('安装期间插件元数据发生变化，请重新加载')
      }
      if (!await installedCompletely(installed)) throw new Error('npm 完成后依赖仍不完整，请检查插件锁文件和包内容')
      await saveState(directory, { schemaVersion: 1, dependencyHash: installed.dependencyHash, runtime,
        installedAt: new Date().toISOString(), success: true })
      this.logger?.info(`插件 ${name} 依赖安装完成`)
      return { ...installed, installed: true, refreshCache: true }
    } catch (error) {
      if (metadata?.hasDependencies && this.autoInstallDependencies) {
        await saveState(directory, { schemaVersion: 1, dependencyHash: metadata.dependencyHash, runtime, success: false }).catch(() => {})
      }
      const reason = error.code || error.message
      const manual = this.autoInstallDependencies ? '' : `；自动依赖安装已关闭。请进入插件目录 ${directory}，执行 npm ${metadata?.lock ? 'ci' : 'install'} --omit=dev 后重新加载`
      const failure = new PluginDependencyError(name, directory, operation, `${reason}${manual}`)
      this.logger?.error(failure.message)
      throw failure
    }
  }
}

module.exports = { PluginDependencyManager, PluginDependencyError, STATE_FILE, npmCommand, runNpm }
