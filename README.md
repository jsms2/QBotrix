# QBotrix

[![CI](https://github.com/jsms2/QBotrix/actions/workflows/ci.yml/badge.svg)](https://github.com/jsms2/QBotrix/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/github/v/release/jsms2/QBotrix)](https://github.com/jsms2/QBotrix/releases)

QBotrix 是面向 QQ 官方机器人单聊与群聊的 Node.js 插件框架，采用 [GPL-3.0-only](./LICENSE) 协议。

项目不预装业务插件，`plugins` 目录仅保留 `.gitkeep`。框架不订阅、也不处理频道消息，支持：

- 插件加载、卸载、重载；
- 插件独立 npm 依赖检测、按需安装和更新，依赖失败不影响其他插件；
- 单聊（`c2c`）和群聊（`group`）命令；
- 群 @ 机器人命令、单聊命令的 `/命令 参数`、`命令 参数` 双格式路由；
- 群聊全量消息和单聊消息插件回调；
- 按钮互动、群成员加入事件插件回调；
- 插件变化后自动同步 QQ 的单聊、群聊指令面板；
- MySQL 或 SQLite 调用/回复审计、插件数据表权限隔离；
- 带插件子配置页的 Web 管理页面和交互式控制台。

## 插件开发文档

完整开发指南见 [插件开发文档](./docs/plugin-development.md)，包含可复制的最小插件、完整数据库与网页面板示例、命令和事件 API、官方卡片申请回调、MySQL/SQLite 兼容、配置存放规则、生命周期与测试方法。

> QBotrix 是独立开源项目，与腾讯无隶属关系。本项目使用 [`qq-official-bot`](https://github.com/zhinjs/qq-official-bot) 作为传输层，调用 QQ 官方 OpenAPI；插件框架、路由和生命周期由本项目实现。

## 环境要求与启动

需要 Node.js 22.13 或更高版本（使用内置 `node:sqlite`）。

```bash
git clone https://github.com/jsms2/QBotrix.git
cd QBotrix
npm ci
```

复制环境变量模板（已有 `.env` 时直接编辑，不要覆盖）：

```powershell
# Windows PowerShell
copy .env.example .env
```

```bash
# Linux / macOS
cp .env.example .env
```

编辑 `.env`，至少填写：

```dotenv
QQBOT_APPID=你的 AppID
QQBOT_SECRET=你的 AppSecret
QQBOT_WEB_TOKEN=替换为随机生成且至少16字符的管理令牌
```

可运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成管理令牌。保存 `.env` 后运行 `npm start`，在本机打开 `http://127.0.0.1:3000` 并用该令牌登录。

默认使用 SQLite，无需填写数据库配置。启动时自动创建 `data/qqbot.sqlite` 并初始化框架表；后续启动复用该文件。若要使用 MySQL，在 `.env` 中另外填写：

```dotenv
QQBOT_DATABASE_TYPE=mysql
QQBOT_MYSQL_HOST=127.0.0.1
QQBOT_MYSQL_PORT=3306
QQBOT_MYSQL_USER=机器人数据库用户
QQBOT_MYSQL_PASSWORD=机器人数据库密码
QQBOT_MYSQL_DATABASE=机器人数据库名
```

`QQBOT_DATABASE_TYPE` 可设为 `sqlite` 或 `mysql`，未设置时为 `sqlite`。切换数据库不会自动迁移另一后端中的数据。

机器人订阅 `GROUP_AND_C2C_EVENT`、`GROUP_MEMBER` 和 `INTERACTION`。群聊全量消息、群成员变更和按钮互动还需要机器人账号已获得平台对应权限；没有相应权限时，其他已授权事件仍可正常工作。

## 插件独立 npm 依赖

插件可以携带自己的 `package.json`、`package-lock.json` 和 `node_modules`。框架在加载前检查 SHA-256 状态和依赖完整性，只有首次安装、清单/锁文件变化、安装失败或明显缺包等情况才执行 npm；不会每次启动都安装，也不会修改框架根依赖。没有清单或运行依赖的旧插件保持原行为。

```text
plugins/example-plugin/
├─ index.js
├─ package.json
└─ package-lock.json
```

有锁文件使用 `npm ci --omit=dev`，没有锁文件使用 `npm install --omit=dev`，工作目录均为插件目录。开发时 `npm install 包名` 也应在该目录执行。每个插件维护自己的版本；删除整个插件目录时依赖一同删除。

自动安装默认开启。可以在 Web 管理页面关闭，或在现有 `data/framework-config.json` 设置以下配置，重启后生效：

```json
{
  "plugins": { "autoInstallDependencies": false }
}
```

关闭后缺少依赖的插件会被跳过，日志给出手动安装命令，其他插件继续加载。自动安装**允许执行第三方 npm 安装脚本**，不会默认加 `--ignore-scripts`；只应安装可信来源的插件。

完整配置、状态存储、更新流程、安全边界及排错见 [插件依赖管理](./docs/plugin-dependencies.md)，可运行的 CommonJS/ESM 示例见 [独立依赖示例](./examples/plugins/independent-dependencies/README.md)。示例位于 examples，不预装到 plugins。

## 插件格式

默认自动加载 `plugins` 目录内的 `.js`、`.cjs`、`.mjs` 文件和 Node.js 包目录。插件支持 CommonJS 和 ESM default 导出；以下示例使用 CommonJS：

```js
module.exports = {
  name: 'my-plugin',

  async setup({ registerCommand, onGroupMessage, onC2CMessage, onButtonInteraction, onGroupMemberAdd, registerWebPage, uploadTemporaryImage, mysql, bot, logger }) {
    registerCommand({
      name: '你好',
      description: '回复一条问候',
      scopes: ['c2c', 'group'],
      inCommandPanel: true, // 是否申请加入 QQ 官方指令卡片，默认 true
      priority: 'normal', // critical / high / normal / low / optional
      required: false, // true 表示必须保留在卡片中
      onPanelResult(result) {
        logger.info(`命令 /${result.name} 的卡片申请${result.approved ? '通过' : '未通过'}：${result.reason}`)
      },
      async handler(args, reply, event) {
        // 字符串会由框架自动作为 Markdown 发送。
        await reply(args === undefined ? '你好' : args)
      },
    })

    onGroupMessage(async (event, reply) => {
      // 群聊全量事件，包括群 @ 消息。
    })

    onC2CMessage(async (event, reply) => {
      // 所有单聊消息事件，包括命令消息。
    })

    onButtonInteraction(async event => {
      // 按钮互动事件；框架会先回应 QQ 后台，再把事件传给插件。
    })

    onGroupMemberAdd(async event => {
      // 群成员加入事件。
    })

    registerWebPage({
      title: '我的插件配置',
      async handler(request, response, web) {
        // 该处理器只会收到分配给本插件 URL 前缀下的请求。
        // 配置的加载与保存由插件自己完成。
        web.sendHtml(response, 200, web.layout('配置', '<h1>插件配置</h1>'))
      },
    })

    // 上传临时图片并获得公网 URL。支持 PNG/JPEG Data URL；
    // Buffer 需要同时传入 contentType，也可以传入 HTTP/HTTPS 图片地址。
    const imageUrl = await uploadTemporaryImage('data:image/png;base64,...')
    const bufferUrl = await uploadTemporaryImage(Buffer.from('...'), {
      contentType: 'image/png',
      fileName: 'example.png',
    })
    const mirroredUrl = await uploadTemporaryImage('https://example.com/image.png')

    // 插件只能访问 _public_ 和自己的 _plugin_my_plugin_ 前缀表。
    const settingsTable = mysql.pluginTable('settings')
    await mysql.execute(`CREATE TABLE IF NOT EXISTS ${settingsTable} (id INT PRIMARY KEY)`)

    // 可选：setup 返回的函数会在卸载/重载/关闭时调用。
    return async () => logger.info('插件已清理')
  },

  // 可选；若同时提供 setup 清理函数，两个清理函数都会执行。
  async teardown() {},
}
```

`name` 不带 `/`。用户既可以发送 `/名称 参数`，也可以直接发送 `名称 参数`。框架先对消息执行 `trim()`；消息只有命令名称时，`args` 为 `undefined`，带参数时，第一个空白字符之后的原始内容作为 `args`。命令名称不区分大小写，并且同一名称（包括仅大小写不同的形式）只能注册一次。

群聊指令会同时从全量群消息事件和群 @ 消息事件中解析。即使开启全量消息接收后不再产生群 @ 专用事件，指令仍可正常执行；两种事件同时出现时，同一消息只会执行一次。

插件的 `reply` API 统一发送 Markdown：传入字符串时框架会自动创建 Markdown 消息，也可以传入 `segment.markdown(...)`。普通文本、图片等非 Markdown 消息段不会被接受；图片应使用 Markdown 图片语法，并在需要时先通过 `uploadTemporaryImage` 获得公网地址。

插件文件负责命令注册、事件回调以及最终发送内容的 Markdown 构建。`plugins/_lib` 只放查询、网络访问、协议解析和数据处理等功能实现，并返回结构化数据；不要在 `_lib` 中调用 `reply`、创建消息段或拼装面向用户的 Markdown/文本报告。

框架通过插件上下文提供 `uploadTemporaryImage(image, options)`。上传站点、鉴权和返回地址校验由主框架统一管理，插件不应直接调用临时图床接口。

框架还提供受限的 `mysql` 对象，支持 `query(sql, values)`、`execute(sql, values)` 和 `transaction(async transaction => ...)`。`mysql.publicTable(suffix)` 生成 `_public_` 开头的表名，`mysql.pluginTable(suffix)` 生成当前插件的私有表名。插件名会转换为小写下划线形式，例如 `sample-plugin` 对应 `_plugin_sample_plugin_`。跨数据库、其他插件表、框架表、多语句及数据库管理操作都会被拒绝。

`mysql` 是兼容保留的插件 API 名称，SQLite 模式下调用方式、返回值的 `[rows, fields]` 结构及事务回调保持一致。插件 SQL 应优先使用两种数据库都支持的语法；SQLite 模式还兼容常见的 MySQL 建表类型、`AUTO_INCREMENT`、`ON DUPLICATE KEY UPDATE` 和 `FOR UPDATE`，但无法执行任意 MySQL 专有语法。

同一个命令名称只能注册一次；冲突检查与调用匹配均不区分大小写。需要同时支持单聊和群聊时，在一次注册中使用 `scopes: ['c2c', 'group']`。

发行版启动后加载 0 个插件；可以按 [插件开发文档](./docs/plugin-development.md) 编写插件，再放入 `plugins` 或通过管理页面加载。

## 临时图床配置

管理页面可选择“外部图床”或“内置图床”，保存后重启生效。也可通过下表中的环境变量配置；环境变量优先于网页保存值。默认模式为 `external`，没有默认图床站点或上传地址。未填写必要地址时机器人仍可启动，调用上传 API 会返回具体配置错误。

| 网页配置 / JSON 字段 | 环境变量 | 用途 |
| --- | --- | --- |
| 图床模式 / `imageHostMode` | `QQBOT_IMAGE_HOST_MODE` | `external` 或 `builtin` |
| 外部图床根地址 / `imageHostOrigin` | `QQBOT_IMAGE_HOST_ORIGIN` | 图片公开访问的完整 HTTP/HTTPS 根地址 |
| 外部图床上传地址 / `imageUploadUrl` | `QQBOT_IMAGE_UPLOAD_URL` | 上传接口的完整 HTTP/HTTPS URL，可与图片域名不同 |
| 管理页面公网根地址 / `webPublicRoot` | `QQBOT_WEB_PUBLIC_ROOT` | 内置图床返回的图片 URL 的根地址 |
| 内置图片保留时间 / `imageRetentionHours` | `QQBOT_IMAGE_RETENTION_HOURS` | 默认 24 小时，大于 0 且不超过 8760 小时 |
| 不在网页显示 | `QQBOT_IMAGE_UPLOAD_TOKEN` | 仅外部模式使用的 Bearer 上传令牌 |

外部图床示例：

```dotenv
QQBOT_IMAGE_HOST_MODE=external
QQBOT_IMAGE_HOST_ORIGIN=https://images.example.com
QQBOT_IMAGE_UPLOAD_URL=https://upload.example.com/api/images
QQBOT_IMAGE_UPLOAD_TOKEN=替换为上传服务实际令牌
```

根地址只用于组合图片访问 URL，上传请求只发往 `QQBOT_IMAGE_UPLOAD_URL`。**升级后必须显式填写实际上传地址**；即使旧服务的上传路径是 `/upload.php`，也必须把完整地址写入配置，框架不会再推断路径。外部服务的保留时间由该服务设置，框架的 `imageRetentionHours` 只影响内置模式。

内置图床示例：

```dotenv
QQBOT_IMAGE_HOST_MODE=builtin
QQBOT_WEB_PUBLIC_ROOT=https://bot.example.com
QQBOT_IMAGE_RETENTION_HOURS=24
```

公网域名通过反向代理指向管理服务的监听地址，例如 `127.0.0.1:3000`。必须让 QQ 服务端能匿名访问 `/images/*`；管理界面和插件页面仍需登录，不要给图片路径额外加登录验证。内置上传仅通过框架 API 和已鉴权的插件页面完成，没有公开上传入口，不需要图床 Token。`QQBOT_WEB_TOKEN` 仍是管理服务启动的必要配置。

内置图片二进制和固定过期时间保存在当前 MySQL/SQLite 的 `_framework_temporary_images` 表，重启后可继续访问未过期图片。启动时和每 10 分钟自动删除过期记录；访问检查独立执行，到期立即返回 404。修改保留时间仅影响之后上传的图片。图片响应使用 `no-store`。根地址可包含路径前缀，代理必须剥离此前缀后再转发到框架；管理页面自身使用 `/` 根路径链接，推荐配置独立域名。

两种模式都保持插件 `uploadTemporaryImage(image, options)` API 不变，支持 PNG/JPEG、每张最多 30 MiB。临时图片会到期，保存到插件业务数据中的图片 URL 不会自动重传；长期使用的回复需使用长期图床或自行保留原图并重新上传。

30 MiB 按 30 × 1024 × 1024 字节计算。如果自行开发的插件页面使用 Base64 JSON 上传 30 MiB 图片，插件接口与代理的请求体限制需至少 41 MiB（例如 `client_max_body_size 41m`）；外部图床 multipart 请求限制为 31 MiB，PHP 上传配置需使用 `upload_max_filesize=30M`、`post_max_size=31M`。

外部图床后端协议、部署、自动清理及可独立运行的 Node.js/PHP 示例见 [外部图床开发与部署](./docs/external-image-host.md)。

## 数据库与审计

框架启动时创建并维护调用审计表：

- `_framework_call_log`：同一张表记录用户命令、插件事件回调及机器人回复。每次调用使用 `correlation_id` 关联，保存作用域、插件、命令/事件、用户、群、消息、内容、完整事件/回复详情、发送状态和错误信息。

选择内置图床时还会初始化 `_framework_temporary_images` 表，用于保存临时图片和过期时间。

框架不会自动在命令前施加业务限流。需要限流的插件自行创建和维护自己的业务表，并在业务处理器中执行。框架不预建插件业务表。

## 运行时管理

程序默认在 `http://127.0.0.1:3000` 启动 Web 管理页面，可加载、卸载、重载插件，修改非敏感框架配置，并进入插件申请的子配置页。必须通过 `QQBOT_WEB_TOKEN` 配置至少 16 个字符的管理令牌，否则管理服务拒绝启动；所有监听地址的管理页面均强制登录。登录成功后浏览器只保存随机、限时的 HttpOnly 会话标识，不会保存管理令牌本身；连续登录失败还会触发临时限制。监听公网地址时仍应配置防火墙或反向代理访问控制。

可用环境变量：`QQBOT_WEB_HOST`、`QQBOT_WEB_PORT`、`QQBOT_WEB_TOKEN`。网页保存的非敏感配置位于 `data/framework-config.json`，完整生效需要重启；AppSecret、MySQL 密码、图床 Token 等敏感值仍只从环境变量读取。

插件通过 `registerWebPage({ title, handler })` 申请一个 `/plugins/<插件名>` URL 前缀。框架只负责鉴权、路由与通用 HTML/表单工具，具体页面以及配置加载、校验、保存均由插件处理。

在交互式终端中可使用：

```text
plugins
load <插件路径>
unload <插件名>
reload <插件名>
help
```

代码中也可以调用 `framework.plugins.load(path)`、`unload(name)`、`reload(name)`。

## 指令面板同步

命令注册时可配置：

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `inCommandPanel` | `true` | 是否申请加入 QQ 官方指令卡片；设为 `false` 仍可通过消息调用命令 |
| `priority` | `normal` | `critical`、`high`、`normal`、`low`、`optional`，从高到低排序 |
| `required` | `false` | 必须保留，优先于所有非必选命令；不能与 `inCommandPanel: false` 同时使用 |
| `onPanelResult(result)` | 无 | 同步成功后的卡片申请结果回调，支持异步函数 |

框架统一从所有插件申请展示的命令中选择最多 20 个。申请数不超过 20 时全部展示；超过时先保留所有 `required: true` 命令，再按 `priority` 填满剩余名额。同一等级按插件加载顺序及插件内命令注册顺序选择，默认目录加载时按插件文件名排序；插件应使用确定性的注册顺序。必选命令超过 20 个会直接报配置错误，并且不发出任何指令面板 API 请求。

20 个名额按命令统计，同时支持单聊和群聊的同一个命令只占一个名额。选出后分别同步到 `c2c` 和 `group` 的 `all` 面板，每个作用域最多一个框架面板。未入选命令仍然正常注册、路由和使用，日志会记录它的名称、插件及优先级；主动关闭 `inCommandPanel` 的命令不属于名额淘汰。

框架只管理备注以 `qq-plugin-framework:` 开头的面板，不会删除其他面板；旧版本拆分出的多余框架面板会在同步时清理。

`onPanelResult` 在两个作用域都同步成功后执行，返回 `{ name, pluginName, requested, approved, priority, required, reason }`。`approved` 表示该命令是否通过卡片申请；`reason` 为 `approved`（通过）、`capacity`（名额不足）或 `not-requested`（未申请）。插件注册完成后的首次同步以及后续加载、卸载、重载导致的每次重新同步都会回调，方便插件获知名额变化。QQ API 同步失败或必选命令超过上限时，不通知通过结果，由加载/同步操作抛出错误。单个回调出错会记录日志，其他命令仍会收到通知，已经同步的卡片和已注册命令不受影响。

程序启动时会先加载完整个插件目录，再统一同步一次面板。运行期间单独加载、卸载、重载插件时仍会串行同步。QQ 接口存在频率限制；同步器会对比远端内容，内容未变化时不重复写入。

## 测试

```bash
npm test
npm run check
npm run smoke
```

自动检查在 Linux 和 Windows 上使用 Node.js 22、24 运行上述命令，不需要 QQ 凭据或真实 MySQL 服务。依赖集成测试使用离线本地 npm 包；smoke 启动真实 SQLite/Web 服务，以模拟 QQ 事件验证框架生命周期，不连接 QQ 平台。

## 参与项目

请先阅读 [贡献指南](./CONTRIBUTING.md)。功能建议和一般问题可提交到 [Issues](https://github.com/jsms2/QBotrix/issues)，安全漏洞请按 [安全政策](./SECURITY.md) 私下报告。

版本记录见 [CHANGELOG.md](./CHANGELOG.md)，发布步骤见 [RELEASE.md](./RELEASE.md)。运行数据、审计记录和密钥不应提交到仓库。插件在机器人进程中执行，应只加载可信代码；数据库表名前缀限制不是不可信代码的安全沙箱。

## 许可证与第三方依赖

Copyright (C) 2026 jsms2 and QBotrix contributors.

QBotrix 的代码、文档和示例以 **GNU GPL version 3 only (`GPL-3.0-only`)** 发布，完整条款见 [LICENSE](./LICENSE)。第三方依赖保留各自许可证，清单见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
