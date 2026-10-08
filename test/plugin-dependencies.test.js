// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PluginDependencyManager, PluginDependencyError, STATE_FILE, npmCommand, runNpm } = require('../src/plugin-dependencies')
const { PluginManager } = require('../src/plugin-manager')
const { FrameworkConfigStore, normalizeFrameworkConfig } = require('../src/framework-config')

const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this } }

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qbotrix-deps-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

async function json(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
}

async function fixture(root, name = 'example', manifest = { dependencies: { 'tiny-dependency': '1.0.0' } }) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'index.js'), `module.exports = { name: '${name}', setup({bot}) { bot.loaded.push('${name}') } }`)
  if (manifest) await json(path.join(directory, 'package.json'), { name, private: true, ...manifest })
  return directory
}

function fakeNpm(calls = []) {
  return async (directory, args) => {
    calls.push({ directory, args })
    if (args[0] === 'ls') return
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json')))
    const lockFile = path.join(directory, 'package-lock.json')
    let lock
    try { lock = JSON.parse(await fs.readFile(lockFile)) }
    catch { lock = { lockfileVersion: 3, packages: { '': { dependencies: manifest.dependencies } } } }
    await fs.mkdir(path.join(directory, 'node_modules'), { recursive: true })
    for (const [name, version] of Object.entries(manifest.dependencies || {})) {
      const packageRoot = path.join(directory, 'node_modules', name)
      await json(path.join(packageRoot, 'package.json'), { name, version, main: 'index.js' })
      await fs.writeFile(path.join(packageRoot, 'index.js'), `module.exports = {version: '${version}', location: __filename}`)
      lock.packages[`node_modules/${name}`] = { version }
    }
    await json(lockFile, lock)
  }
}

test('无 package.json、无运行依赖及仅 devDependencies 的插件不运行 npm 或创建状态', async t => {
  const root = await temporaryRoot(t)
  const calls = []
  const dependencies = new PluginDependencyManager({ logger, runNpm: fakeNpm(calls) })
  for (const [name, manifest] of [['legacy', null], ['empty', {}], ['dev', { devDependencies: { typescript: '^5.0.0' } }]]) {
    const directory = await fixture(root, name, manifest)
    await dependencies.ensure(directory)
    await assert.rejects(fs.access(path.join(directory, STATE_FILE)), { code: 'ENOENT' })
  }
  assert.equal(calls.length, 0)
})

test('首次 install、生成锁文件后跳过、跨实例复用状态以及清单/锁文件变化重新 ci', async t => {
  const root = await temporaryRoot(t)
  const directory = await fixture(root)
  const calls = []
  const options = { logger, runNpm: fakeNpm(calls) }
  const dependencies = new PluginDependencyManager(options)
  assert.equal((await dependencies.ensure(directory)).installed, true)
  const state = JSON.parse(await fs.readFile(path.join(directory, STATE_FILE)))
  assert.match(state.dependencyHash, /^[a-f0-9]{64}$/u)
  assert.equal(state.success, true)
  assert.ok(Date.parse(state.installedAt))
  await dependencies.ensure(directory)
  await new PluginDependencyManager(options).ensure(directory)
  assert.deepEqual(calls.map(call => call.args), [['install', '--omit=dev']])
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json')))
  await json(path.join(directory, 'package.json'), { ...manifest, description: 'updated' })
  await dependencies.ensure(directory)
  await fs.appendFile(path.join(directory, 'package-lock.json'), '\n')
  // A real npm ci preserves the exact lock bytes.
  const ci = new PluginDependencyManager({ logger, runNpm: async (cwd, args) => { calls.push({directory: cwd, args}) } })
  await ci.ensure(directory)
  await ci.ensure(directory)
  assert.deepEqual(calls.map(call => call.args[0]), ['install', 'ci', 'ci'])
  assert.ok(calls.every(call => call.directory === directory))
})

test('删除 node_modules、缺包、缺入口、错误版本、失败/损坏状态均会重新安装', async t => {
  const root = await temporaryRoot(t)
  const directory = await fixture(root)
  const calls = []
  const dependencies = new PluginDependencyManager({ logger, runNpm: fakeNpm(calls) })
  await dependencies.ensure(directory)
  const damage = [
    () => fs.rm(path.join(directory, 'node_modules'), { recursive: true }),
    () => fs.rm(path.join(directory, 'node_modules', 'tiny-dependency', 'package.json')),
    () => fs.rm(path.join(directory, 'node_modules', 'tiny-dependency', 'index.js')),
    () => json(path.join(directory, 'node_modules', 'tiny-dependency', 'package.json'), {
      name:'tiny-dependency', version:'1.0.0', exports:{'.':{import:'./missing.mjs', require:'./index.js'}},
    }),
    () => json(path.join(directory, 'node_modules', 'tiny-dependency', 'package.json'), { name: 'tiny-dependency', version: '9.0.0' }),
    async () => { const state = JSON.parse(await fs.readFile(path.join(directory, STATE_FILE))); state.success = false; await json(path.join(directory, STATE_FILE), state) },
    () => fs.writeFile(path.join(directory, STATE_FILE), '{bad'),
    async () => { const state = JSON.parse(await fs.readFile(path.join(directory, STATE_FILE))); state.runtime = 'old-node'; await json(path.join(directory, STATE_FILE), state) },
  ]
  for (const mutate of damage) {
    const previous = calls.length
    await mutate()
    await dependencies.ensure(directory)
    await dependencies.ensure(directory)
    assert.equal(calls.length, previous + 1)
    assert.deepEqual(calls.at(-1).args, ['ci', '--omit=dev'])
  }
})

test('缺失锁定的间接依赖会触发修复', async t => {
  const root = await temporaryRoot(t)
  const directory = await fixture(root)
  let installs = 0
  const install = fakeNpm()
  const dependencies = new PluginDependencyManager({ logger, runNpm: async (cwd, args) => {
    installs++
    await install(cwd, args)
    const lockFile = path.join(cwd, 'package-lock.json')
    const lock = JSON.parse(await fs.readFile(lockFile))
    lock.packages['node_modules/transitive'] = { version: '1.0.0' }
    await json(lockFile, lock)
    await json(path.join(cwd, 'node_modules', 'transitive', 'package.json'), { name: 'transitive', version: '1.0.0' })
  } })
  await dependencies.ensure(directory)
  await fs.rm(path.join(directory, 'node_modules', 'transitive'), { recursive: true })
  await dependencies.ensure(directory)
  assert.equal(installs, 2)
})

test('损坏清单、锁文件、错误依赖声明及已删除目录产生可定位错误，不运行 npm', async t => {
  const root = await temporaryRoot(t)
  const directory = await fixture(root)
  const calls = []
  const dependencies = new PluginDependencyManager({ logger, runNpm: fakeNpm(calls) })
  for (const content of ['{secret-not-for-logs', '[]', '{"dependencies": []}', '{"dependencies":{"../escape":"1"}}']) {
    await fs.writeFile(path.join(directory, 'package.json'), content)
    await assert.rejects(dependencies.ensure(directory), error => error instanceof PluginDependencyError
      && error.message.includes(directory) && !error.message.includes('secret-not-for-logs'))
  }
  await fixture(root)
  for (const content of ['{invalid', '{"lockfileVersion":3}', '{"lockfileVersion":99}']) {
    await fs.writeFile(path.join(directory, 'package-lock.json'), content)
    await assert.rejects(dependencies.ensure(directory), /package-lock.json/u)
  }
  await fs.rm(directory, { recursive: true })
  await assert.rejects(dependencies.ensure(directory), /ENOENT/u)
  assert.equal(calls.length, 0)
})

test('安装失败写入失败状态，不执行插件代码；目录扫描继续加载健康插件并同步一次', async t => {
  const root = await temporaryRoot(t)
  const pluginRoot = path.join(root, 'plugins')
  const broken = await fixture(pluginRoot, 'a-broken')
  await fixture(pluginRoot, 'b-healthy', null)
  const bot = { loaded: [] }
  let calls = 0
  let syncs = 0
  const dependencies = new PluginDependencyManager({ logger, runNpm: async () => { calls++; throw Object.assign(new Error('network'), {code: 'ECONNRESET'}) } })
  const manager = new PluginManager({ bot, logger, baseDir: root, dependencyManager: dependencies,
    synchronizer: { async synchronize() { syncs++ } } })
  t.after(() => manager.close())
  const loaded = await manager.loadDirectory('plugins')
  assert.deepEqual(loaded.map(plugin => plugin.name), ['b-healthy'])
  assert.deepEqual(bot.loaded, ['b-healthy'])
  assert.equal(syncs, 1)
  assert.equal(JSON.parse(await fs.readFile(path.join(broken, STATE_FILE))).success, false)
  await assert.rejects(manager.load(broken), /npm install --omit=dev.*ECONNRESET/u)
  assert.equal(calls, 2)
  dependencies.runNpm = fakeNpm()
  await manager.load(broken)
  assert.deepEqual(bot.loaded, ['b-healthy', 'a-broken'])
})

test('自动安装关闭：缺依赖时给出手动命令，手动安装后验证并记录状态，随后轻量跳过', async t => {
  const root = await temporaryRoot(t)
  const directory = await fixture(root)
  const calls = []
  const dependencies = new PluginDependencyManager({ logger, autoInstallDependencies: false, runNpm: fakeNpm(calls) })
  await assert.rejects(dependencies.ensure(directory), /自动依赖安装已关闭.*npm install --omit=dev/u)
  assert.equal(calls.length, 0)
  await fakeNpm()(directory, ['install', '--omit=dev'])
  await dependencies.ensure(directory)
  await dependencies.ensure(directory)
  assert.deepEqual(calls.map(call => call.args), [['ls', '--omit=dev', '--depth=0']])
  await fs.rm(path.join(directory, 'node_modules', 'tiny-dependency'), {recursive: true})
  await assert.rejects(dependencies.ensure(directory), /npm ci --omit=dev/u)
  assert.equal(calls.length, 1)
})

test('同插件多个管理器和入口别名共享单个安装，不同插件可并行安装', async t => {
  const root = await temporaryRoot(t)
  const one = await fixture(root, 'one')
  const two = await fixture(root, 'two')
  let active = 0
  let maximum = 0
  const calls = []
  const install = fakeNpm(calls)
  const runner = async (...args) => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 25))
    await install(...args)
    active--
  }
  const options = {logger, runNpm: runner}
  await Promise.all([
    new PluginDependencyManager(options).ensure(one),
    new PluginDependencyManager(options).ensure(path.join(one, 'index.js')),
    new PluginDependencyManager(options).ensure(one),
    new PluginDependencyManager(options).ensure(two),
  ])
  assert.equal(calls.length, 2)
  assert.equal(maximum, 2)
})

test('重复扫描及并行 load 保持安装去重、setup 顺序和重复名称检查', async t => {
  const root = await temporaryRoot(t)
  const directory = await fixture(path.join(root, 'plugins'))
  const calls = []
  const manager = new PluginManager({bot: {loaded: []}, logger, baseDir: root,
    dependencyManager: new PluginDependencyManager({logger, runNpm: fakeNpm(calls)}),
    synchronizer: {async synchronize() {}}})
  t.after(() => manager.close())
  await manager.loadDirectory()
  await manager.reload('example')
  const results = await Promise.allSettled([manager.load(directory), manager.loadDirectory()])
  assert.ok(results.every(result => result.status === 'rejected'))
  assert.equal(calls.length, 1)
  assert.equal(manager.listPlugins().length, 1)
})

test('CommonJS 插件依赖版本更新后重载实际使用自己的新模块，不污染其他插件', async t => {
  const root = await temporaryRoot(t)
  for (const [name, version] of [['one', '1.0.0'], ['two', '2.0.0']]) {
    const directory = await fixture(root, name, {dependencies: {'tiny-dependency': version}})
    await fs.writeFile(path.join(directory, 'index.js'), `const dep = require('tiny-dependency'); module.exports = {name:'${name}', setup({bot}) {bot.versions.push(dep)}}`)
  }
  const bot = { versions: [] }
  const manager = new PluginManager({bot, logger, baseDir: root,
    dependencyManager: new PluginDependencyManager({logger, runNpm: fakeNpm()}), synchronizer: {async synchronize() {}}})
  t.after(() => manager.close())
  await Promise.all([manager.load('one'), manager.load('two')])
  assert.deepEqual(bot.versions.map(dep => dep.version), ['1.0.0', '2.0.0'])
  assert.ok(bot.versions.every((dep, index) => dep.location.startsWith(path.join(root, index ? 'two' : 'one', 'node_modules'))))
  const directory = path.join(root, 'one')
  await json(path.join(directory, 'package.json'), {name:'one', dependencies: {'tiny-dependency':'3.0.0'}})
  const lock = JSON.parse(await fs.readFile(path.join(directory, 'package-lock.json')))
  lock.packages['node_modules/tiny-dependency'].version = '3.0.0'
  await json(path.join(directory, 'package-lock.json'), lock)
  await manager.reload('one')
  assert.equal(bot.versions.at(-1).version, '3.0.0')
  await manager.reload('two')
  assert.equal(bot.versions.at(-1).version, '2.0.0')
  manager.configure({autoInstallDependencies:false})
  await json(path.join(directory, 'package.json'), {name:'one', dependencies:{'tiny-dependency':'4.0.0'}})
  await fakeNpm()(directory, ['install', '--omit=dev'])
  await manager.reload('one')
  assert.equal(bot.versions.at(-1).version, '4.0.0')
})

test('Windows npm.cmd 所在路径含空格和 shell 字符时，直接以 Node argv 执行 npm CLI', async t => {
  const root = await temporaryRoot(t)
  const npmRoot = path.join(root, 'npm path & 中文')
  const cli = path.join(npmRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await fs.mkdir(path.dirname(cli), {recursive: true})
  await fs.writeFile(cli, '')
  await fs.writeFile(path.join(npmRoot, 'npm.cmd'), '')
  const env = {Path: npmRoot}
  assert.deepEqual(await npmCommand({platform:'win32', env}), {command:process.execPath, prefix:[cli]})
  let call
  await runNpm(root, ['ci', '--omit=dev'], {platform:'win32', env, spawnImpl(command, args, options) {
    call = {command, args, options}
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0, null))
    return child
  }})
  assert.deepEqual(call.args, [cli, 'ci', '--omit=dev'])
  assert.equal(call.command, process.execPath)
  assert.equal(call.options.shell, false)
  assert.equal(call.options.cwd, root)
  assert.equal(call.options.windowsHide, true)
  assert.ok(!call.args.includes('--ignore-scripts'))
  assert.deepEqual(await npmCommand({platform:'linux'}), {command:'npm', prefix:[]})
  await assert.rejects(npmCommand({platform:'win32', env:{}}), /未找到 npm.cmd/u)
})

test('npm 缺失、网络/磁盘错误和信号退出有明确原因，子进程输出不泄露秘密', async () => {
  for (const scenario of ['missing', 'ENOSPC', 'ECONNRESET', 'signal']) {
    await assert.rejects(runNpm('.', ['install', '--omit=dev'], {platform:'linux', spawnImpl() {
      const child = new EventEmitter()
      child.stderr = new EventEmitter()
      queueMicrotask(() => {
        if (scenario === 'missing') child.emit('error', Object.assign(new Error('secret-env-value'), {code:'ENOENT'}))
        else {
          child.stderr.emit('data', Buffer.from(`secret-env-value\nnpm error code ${scenario}\n`))
          child.emit('close', scenario === 'signal' ? null : 1, scenario === 'signal' ? 'SIGTERM' : null)
        }
      })
      return child
    }}), error => !error.message.includes('secret-env-value') && error.message.includes(
      scenario === 'missing' ? 'ENOENT' : scenario === 'signal' ? 'SIGTERM' : scenario))
  }
})

test('统一配置默认开启、持久化关闭值、返回值隔离并校验布尔类型', async t => {
  const root = await temporaryRoot(t)
  assert.equal(normalizeFrameworkConfig().plugins.autoInstallDependencies, true)
  assert.throws(() => normalizeFrameworkConfig({plugins:{autoInstallDependencies:'false'}}), /布尔值/u)
  assert.throws(() => normalizeFrameworkConfig({plugins:[]}), /对象/u)
  const file = path.join(root, 'config.json')
  const store = new FrameworkConfigStore(file)
  await store.update({plugins:{autoInstallDependencies:false}})
  const copy = store.get()
  copy.plugins.autoInstallDependencies = true
  assert.equal(store.get().plugins.autoInstallDependencies, false)
  assert.equal((await new FrameworkConfigStore(file).load()).plugins.autoInstallDependencies, false)
})
