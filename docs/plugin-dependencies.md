# 插件独立 npm 依赖管理

插件可以携带独立的 `package.json` 声明 npm 依赖。框架在加载插件前会检查依赖状态，并在需要时自动安装。旧的单文件插件、没有清单或没有运行时依赖的插件继续直接加载，无需迁移。

## 目录与架构

```text
plugins/example-plugin/
├─ index.js
├─ package.json
├─ package-lock.json
├─ node_modules/                 自动安装，禁止提交
└─ .qbotrix-dependencies.json     框架状态，禁止提交
```

每个插件的清单、锁文件、依赖和状态都在插件自己的目录。框架不合并插件依赖、不使用 npm workspaces、不修改根 `package.json` 或根锁文件。Node.js 使用正常模块解析从插件的 `node_modules` 加载包，不使用 VM 或模块解析 hook。不同插件可使用同一个包的不同版本。

Node 的标准解析也允许向父目录查找依赖；开发者必须在插件清单中声明实际使用的包，不能依赖这种回退碰巧找到框架依赖。完整性检查直接检查插件自己的依赖目录，不会将根目录中同名包当作安装成功。

卸载只停止插件，保留其依赖供下次加载使用；删除整个插件目录即可删除该插件的 node_modules 和依赖状态，不需要全局依赖清理。插件数据库记录仍需按业务需要单独处理。

## 清单规范与开发

```json
{
  "name": "qbotrix-plugin-example",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "type": "module",
  "dependencies": {
    "dayjs": "1.11.18"
  }
}
```

- 必须是合法 JSON，推荐 `private: true` 防止误发布。
- 运行时依赖写入 `dependencies`，开发工具写入 `devDependencies`。
- 生产安装使用 `--omit=dev`，省略开发依赖；npm 的正常 optional/peer 依赖规则仍然适用。
- 不要把 QBotrix 框架本体重复声明成普通依赖，插件通过已有 setup 上下文调用框架 API。
- 提交 `package-lock.json`，获得确定的 `npm ci` 安装；不支持 `npm-shrinkwrap.json`，避免 npm 使用另一份优先级更高的锁文件。
- 需要 npm 在 PATH 中可用，插件目录需要安装和写状态的权限。

添加或升级依赖时，应在**插件目录**执行：

```bash
cd plugins/example-plugin
npm install dayjs
```

把清单和锁文件一起发布。框架根目录的 npm overrides 不会应用到独立插件；插件作者负责审计自己声明的依赖，必要时在插件自己的清单中配置 overrides。

ESM 使用 `type: module` 的 `.js` 入口或 `.mjs`，导出 `default { name, setup }`，可以直接 `import dayjs from 'dayjs'`，也支持顶层 await。CommonJS 使用 `.cjs` 或 CommonJS `.js`，直接 `const dayjs = require('dayjs')`。可运行的两种入口见 [示例插件](../examples/plugins/independent-dependencies/README.md)。单文件 `.js/.cjs/.mjs` 插件仍受支持；需要依赖时应使用独立插件目录，不在 `plugins` 集合目录放置共享清单。

## 检查、安装与状态

启动扫描、控制台 load/reload、Web load/reload 和 `framework.plugins.load/reload` 均走同一个检查流程：

1. 定位插件目录，读取清单；没有清单或没有运行依赖时直接加载。
2. 对清单和锁文件的原始文本计算 SHA-256，读取本插件的状态。
3. 检查 node_modules、必需的直接依赖、锁定的生产间接依赖、已安装版本及声明的 main/根 exports 入口。此检查用于发现明显缺失，不对所有包文件做完整性审计。
4. 状态成功、hash 和 Node ABI/平台/架构匹配、依赖完整时跳过 npm。
5. 否则先写失败状态，在插件自己的工作目录执行安装，安装后再次验证并保存成功状态，然后才导入插件和调用 setup。

有锁文件：

```bash
npm ci --omit=dev
```

没有锁文件：

```bash
npm install --omit=dev
```

首次安装后 npm 通常生成锁文件，框架用**安装后的清单和锁文件**保存 hash，避免下一次启动再次安装。清单的任何字节变化（含版本、main、格式变化）、锁文件变化、上次失败、状态缺失/损坏、node_modules 缺失、明显缺包或运行环境变化都会重新检查/安装。安装过程中清单被另一个更新流程修改时，本次加载失败，下一次加载重试。`npm ci` 失败不会回退为 `npm install`，以免绕过锁文件。

状态文件 `.qbotrix-dependencies.json` 示例：

```json
{
  "schemaVersion": 1,
  "dependencyHash": "64位SHA-256十六进制摘要",
  "runtime": "win32/x64/137",
  "installedAt": "安装完成的ISO时间",
  "success": true
}
```

框架用同目录临时文件加 rename 原子保存状态。安装前置 `success: false`，进程中断后下次重试；状态文件不记录令牌或环境变量。`runtime` 中的 ABI 值取决于实际 Node.js 版本，上例只展示格式。安装成功不等于插件 setup 成功：业务代码失败后，依赖状态仍可复用。

Windows 通过 PATH 定位 `npm.cmd` 及配套 `npm-cli.js`，再用当前 Node 直接执行 CLI；Linux/macOS 使用 `npm`。两者均使用 argv、`shell: false` 和插件 cwd，不拼接 shell 命令，路径中的空格或 shell 字符不会成为额外命令。

同一进程中，同一个真实插件目录的并发检查共用一个任务，跨管理器、目录/文件入口别名也不会重复安装。不同插件的依赖在目录扫描中并行准备；setup、命令注册和面板同步仍沿用原有队列和顺序。不应让多个机器人进程同时修改同一个插件安装目录。

## 自动安装配置

使用现有 `data/framework-config.json`：

```json
{
  "plugins": {
    "autoInstallDependencies": false
  }
}
```

默认值为 `true`。也可在 Web 管理页面“自动安装插件 npm 依赖”中选择，保存后重启生效。集成框架时可以通过 `frameworkConfig.plugins.autoInstallDependencies` 提供默认值。此项是框架级策略，不是插件业务配置，没有新增另一套配置文件或环境变量。

关闭后，依赖缺失或不完整时不安装、不加载插件，日志给出插件目录及应执行的 `npm ci --omit=dev` 或 `npm install --omit=dev`。手动安装后再次加载，框架用本地 `npm ls --omit=dev --depth=0` 验证并记录状态；该命令不安装包、不联网。后续状态匹配时不再运行 npm ls。依赖已完整且状态有效的插件正常加载。

## 失败与排错

自动安装错误包括：找不到 npm、无效 JSON/锁文件、网络失败、ci 清单不匹配、磁盘或权限错误、安装脚本失败和进程被信号终止。日志包含插件名、路径、npm 操作及可安全展示的错误原因/退出码；不会转发可能包含环境变量或令牌的安装脚本输出。需要详细诊断时，在插件目录手动执行日志所示命令，分享输出前先脱敏。

目录批量扫描时，依赖失败的插件不执行入口或 setup，记录错误并跳过，其他插件继续加载并统一同步面板，框架不会因此退出。单独 load/reload 向调用方返回错误，管理页面或控制台展示失败；机器人继续运行。重载仍先卸载旧实例，新版本失败不会恢复旧版本，可修复后使用 load 再次加载。

没有改变其他加载错误和 QQ 面板同步错误的既有处理方式；例如非法插件导出或 setup 异常仍按原管理器行为报告。

## 安全与热重载边界

**只应安装可信来源的插件。** 自动安装不默认添加 `--ignore-scripts`，依赖的 `preinstall/install/postinstall` 可执行第三方代码，访问当前机器人进程权限允许的文件、网络和环境变量。部分原生模块需要这些脚本；开启自动安装前应审核插件及锁文件。关闭自动安装可将安装审核放到部署阶段，手动 npm 安装本身仍有同样的脚本风险。插件不是安全沙箱。

CommonJS 在重新安装依赖后清理该插件目录内的 require 缓存，后续 setup 使用新依赖；其他插件的独立依赖不会被清理。ESM 使用带代次 URL 的动态 import 重新执行入口，Node.js 仍缓存入口引用的 ESM 子模块。修改 ESM 子模块/依赖、模块类型或有未结束业务请求时，建议重启整个进程，不能保证仅重载入口就替换所有旧引用。框架不能回收插件未自行清理的资源；这一限制与依赖安装是否成功无关。

## 验证

`npm test` 包含依赖管理单元测试、Windows npm 启动测试和离线真实 npm 集成测试。集成测试只打包并安装临时本地包，禁用网络，不依赖 npm 公网；验证安装脚本、omit=dev、CommonJS/ESM 解析、锁文件生成、ci 修复和根依赖不变。`npm run smoke` 启动真实框架、SQLite 和 Web 服务，使用模拟 QQ 事件验证依赖失败隔离、旧插件及重载/卸载，不连接真实 QQ 平台。
