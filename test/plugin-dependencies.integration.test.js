// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PluginManager } = require('../src/plugin-manager')
const { PluginDependencyManager, runNpm } = require('../src/plugin-dependencies')

test('离线真实 npm install/ci、安装脚本、omit=dev、独立 CommonJS/ESM 解析与重载', {timeout: 90000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qbotrix-real-npm-'))
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  const frameworkRoot = path.resolve(__dirname, '..')
  const frameworkManifest = await fs.readFile(path.join(frameworkRoot, 'package.json'))
  const frameworkLock = await fs.readFile(path.join(frameworkRoot, 'package-lock.json'))
  const env = { ...process.env, npm_config_cache: path.join(root, 'cache'), npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:9', npm_config_ignore_scripts: 'false' }
  const offlineNpm = (directory, args) => runNpm(directory, [...args, '--offline'], {env})
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({
    name:'qbotrix-local-dependency', version:'1.0.0', main:'index.js',
    scripts:{postinstall:'node install.cjs'},
  }))
  await fs.writeFile(path.join(source, 'index.js'), 'module.exports = {location: __filename, value: "local-package"}')
  await fs.writeFile(path.join(source, 'install.cjs'), 'require("node:fs").writeFileSync("installed.marker", "yes")')
  await offlineNpm(source, ['pack', '--pack-destination', root])
  const tarball = path.join(root, 'qbotrix-local-dependency-1.0.0.tgz').replaceAll('\\', '/')
  const dev = path.join(root, 'dev-only')
  await fs.mkdir(dev)
  await fs.writeFile(path.join(dev, 'package.json'), JSON.stringify({name:'dev-only', version:'1.0.0'}))
  const installedCalls = []
  const errors = []
  const logger = {info() {}, warn() {}, error(...args) {errors.push(args.map(value => value.message || value).join(' '))}, debug() {}, child() {return this}}
  const dependencies = new PluginDependencyManager({logger, runNpm: async (directory, args) => {
    installedCalls.push(args[0])
    await offlineNpm(directory, args)
  }})
  const bot = {results:[]}
  const manager = new PluginManager({bot, logger, baseDir:root, dependencyManager:dependencies,
    synchronizer:{async synchronize() {}}})
  t.after(() => manager.close())
  for (const [name, esm] of [['commonjs-plugin', false], ['esm-plugin', true]]) {
    const directory = path.join(root, 'plugins', name)
    await fs.mkdir(directory, {recursive:true})
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({name, private:true,
      type:esm ? 'module' : 'commonjs', main:'index.js',
      dependencies:{'qbotrix-local-dependency':`file:${tarball}`},
      devDependencies:{'dev-only':`file:${dev.replaceAll('\\', '/')}`},
    }))
    await fs.writeFile(path.join(directory, 'index.js'), esm
      ? `import dep from 'qbotrix-local-dependency'; await Promise.resolve(); export default {name:'${name}', setup({bot}) {bot.results.push(dep)}}`
      : `const dep = require('qbotrix-local-dependency'); module.exports = {name:'${name}', setup({bot}) {bot.results.push(dep)}}`)
  }
  await manager.loadDirectory('plugins')
  assert.equal(bot.results.length, 2, errors.join('\n'))
  for (const [index, name] of ['commonjs-plugin', 'esm-plugin'].entries()) {
    const directory = path.join(root, 'plugins', name)
    assert.equal(bot.results[index].value, 'local-package')
    assert.equal(bot.results[index].location, path.join(directory, 'node_modules', 'qbotrix-local-dependency', 'index.js'))
    assert.equal(await fs.readFile(path.join(directory, 'node_modules', 'qbotrix-local-dependency', 'installed.marker'), 'utf8'), 'yes')
    await assert.rejects(fs.access(path.join(directory, 'node_modules', 'dev-only')), {code:'ENOENT'})
    await manager.reload(name)
  }
  assert.deepEqual(installedCalls, ['install', 'install'])
  await fs.rm(path.join(root, 'plugins', 'commonjs-plugin', 'node_modules'), {recursive:true})
  await manager.reload('commonjs-plugin')
  assert.deepEqual(installedCalls, ['install', 'install', 'ci'])
  assert.deepEqual(await fs.readFile(path.join(frameworkRoot, 'package.json')), frameworkManifest)
  assert.deepEqual(await fs.readFile(path.join(frameworkRoot, 'package-lock.json')), frameworkLock)
})
