# QQ 官方机器人框架插件开发文档

本文对应本仓库当前实现，更新日期：2026-10-08。框架运行于 Node.js 22.13 或更高版本，插件支持 CommonJS 和 ESM default 导出；QQ 传输层为 `qq-official-bot`。文中的命令卡片、数据库、网页工具均以实际源码为准。

本发行版不预装业务插件，`plugins` 仅保留 `.gitkeep`。本文示例需自行创建；独立依赖的可运行示例在 examples 中，不自动加载。

## 目录

1. [框架职责与文件布局](#1-框架职责与文件布局)
2. [快速开始](#2-快速开始)
3. [生命周期与资源清理](#3-生命周期与资源清理)
4. [插件上下文 API](#4-插件上下文-api)
5. [注册和处理命令](#5-注册和处理命令)
6. [QQ 官方指令卡片与申请回调](#6-qq-官方指令卡片与申请回调)
7. [Markdown 回复和图片上传](#7-markdown-回复和图片上传)
8. [消息与通知事件](#8-消息与通知事件)
9. [数据库 API 与后端兼容](#9-数据库-api-与后端兼容)
10. [网页配置面板 API](#10-网页配置面板-api)
11. [完整示例：数据库设置与网页面板](#11-完整示例数据库设置与网页面板)
12. [插件配置和数据存放规则](#12-插件配置和数据存放规则)
13. [SDK 调用、日志与审计](#13-sdk-调用日志与审计)
14. [加载、重载与调试](#14-加载重载与调试)
15. [测试插件](#15-测试插件)
16. [常见问题](#16-常见问题)
17. [源码索引与发布检查](#17-源码索引与发布检查)

## 1. 框架职责与文件布局

框架负责连接机器人、分发事件、匹配命令、同步 QQ 指令卡片、提供受限数据库对象、上传图片、审计命令和消息回复，以及为管理页面提供鉴权和路由。插件负责业务判断、业务数据表、配置页面、配置验证和最终 Markdown 内容。

框架还在加载插件前检查并按需安装插件的独立 npm 依赖。完整架构、配置与排错见 [插件依赖管理](./plugin-dependencies.md)。

本框架支持 QQ 群聊和单聊，不提供频道业务接口。QQ 平台权限决定机器人实际能收到哪些事件；“全量群消息”指平台已经投递到机器人的群消息。

推荐目录布局：

```text
plugins/
  my-plugin/
    index.js             插件入口：注册命令、事件和页面
    package.json         可选，声明本插件的 npm 依赖
    package-lock.json    推荐提交，锁定本插件依赖
    node_modules/        自动安装，禁止提交
    .qbotrix-dependencies.json  框架依赖状态，禁止提交
    store.js             数据库操作
    service.js           业务处理或外部接口访问
    web.js               管理页面路由
    public/
      app.js             浏览器脚本
      style.css          页面样式
    data/                本插件的静态数据或本地配置
  _lib/                  可选的插件共用业务工具
```

默认自动加载 `plugins` 直接子项中的 `.js`、`.cjs`、`.mjs` 文件和目录，名称以 `.` 或 `_` 开头的子项以及 node_modules 会跳过。因此，将辅助脚本放在自己的插件目录内，或放在 `_lib` 中；不要将普通工具模块直接放在 `plugins` 顶层。目录插件应提供 `index.js/index.cjs/index.mjs`，或在 package.json 配置 main 入口。

**插件的持久化配置、缓存、静态数据和业务记录只能存放在 `plugins` 内或框架数据库中。不得把插件配置添加到根目录 `.env`、`.env.example` 或 `data/framework-config.json`，也不得在根目录 `data` 中创建插件 JSON 文件。** 根目录 `.env` 保留框架配置，例如机器人凭据、数据库连接、管理令牌和公共图床服务配置。

`plugins/_lib` 中的共享工具返回结构化数据。消息回复和面向用户的 Markdown 构建放在插件业务入口中，便于统一审计和维护。

## 2. 快速开始

### 2.1 运行框架

在仓库根目录执行：

```powershell
npm ci
Copy-Item .env.example .env
```

如果 `.env` 已存在，直接编辑它，避免覆盖已有凭据。至少填写 `QQBOT_APPID`、`QQBOT_SECRET` 和长度不小于 16 的 `QQBOT_WEB_TOKEN`。默认使用 SQLite，无需数据库配置；框架启动时自动创建 `data/qqbot.sqlite`，插件的表由插件自行初始化。

```powershell
npm start
```

### 2.2 创建第一个插件

创建 `plugins/greeting/index.js`：

```js
'use strict'

module.exports = {
  name: 'greeting',

  setup({ registerCommand, logger }) {
    registerCommand({
      name: '问候',
      description: '发送一条问候',
      scopes: ['c2c', 'group'],
      inCommandPanel: true,
      priority: 'normal',
      required: false,
      onPanelResult({ approved, reason }) {
        logger.info('问候命令卡片结果', { approved, reason })
      },
      async handler(args, reply) {
        const target = args?.trim() || '朋友'
        await reply(`**你好，${target}！**`)
      },
    })
  },
}
```

重启机器人，或在框架交互式控制台执行：

```text
load plugins/greeting
```

在单聊或群聊发送 `问候`、`/问候`、`问候 张三` 均可触发。命令能否显示在 QQ 卡片中由全局名额决定；即使未显示，也可直接发送消息调用。

### 2.3 为示例插件添加独立依赖

原问候示例无需清单即可继续工作。需要第三方包时，可以为 greeting 添加自己的清单和锁文件：

```text
plugins/greeting/
├─ index.js
├─ package.json
└─ package-lock.json
```

在 greeting 目录执行 `npm install dayjs`（不是框架根目录），并设置清单 `private: true`。运行时包放在 dependencies，测试和编译工具放在 devDependencies。框架生产安装使用 `--omit=dev`，插件不应重复依赖 QBotrix 框架本体。

CommonJS 的 greeting/index.js 可以添加 `const dayjs = require('dayjs')`，用 `dayjs().format('YYYY-MM-DD')` 生成问候日期。若改为 ESM，在清单设置 `type: module`，入口使用 `import dayjs from 'dayjs'` 和 `export default { name, setup }`。入口导出格式和上下文 API 不变。

完整可运行的日期插件（含清单、锁文件及两种入口）见 [示例说明](../examples/plugins/independent-dependencies/README.md)。框架按需安装到本插件 node_modules，并用本插件 `.qbotrix-dependencies.json` 记录清单/锁文件 hash。没有变化且安装完整时不运行 npm。首次无锁安装生成锁文件后，框架记录新的 hash。

清单或锁文件更新后，下一次 load/reload 自动更新依赖。依赖安装失败时入口不执行，目录扫描跳过该插件并继续其他插件；单独 load/reload 返回错误。关闭 `plugins.autoInstallDependencies` 后需手动安装，详见 [统一配置与失败处理](./plugin-dependencies.md)。安装可执行第三方 preinstall/install/postinstall 脚本，只应安装可信来源的插件。

## 3. 生命周期与资源清理

### 3.1 导出格式

推荐导出 `{ name, setup, teardown }` 对象。`setup(context)` 为必需项，可以同步或异步；`teardown()` 可选。也支持直接导出 setup 函数，以及上述对象的 `default` 导出形式。

显式指定 `name`，推荐使用英文小写字母、数字和连字符，例如 `my-plugin`。未填写名称时使用入口文件名推导：目录插件的 `index.js` 会推导成 `index`，容易冲突。插件名称在同一管理器内必须唯一，并同时决定网页 URL 和数据库私有表前缀。

### 3.2 加载顺序

一次加载会执行以下步骤：

1. 读取插件元数据、检查独立依赖状态，必要时在插件目录安装依赖；依赖成功后解析入口并清理相关 CommonJS 缓存（ESM 以新代次 URL 导入入口）。
2. 创建插件专属上下文。
3. 等待 `setup` 完成，收集命令、事件处理器和网页注册。
4. 验证命令名称冲突，将插件纳入运行中的注册列表。
5. 单独加载时同步官方指令卡片；目录批量加载时，全部插件 setup 完成后统一同步一次。
6. 卡片同步成功后执行各命令的 `onPanelResult`。

注册函数应在 `setup` 返回前调用。框架没有提供独立的“运行期间添加/删除一个命令”接口；修改命令声明后重载整个插件。

`registerCommand()` 返回规范化后的命令对象，不返回 Promise。返回对象中的 `inCommandPanel` 表示是否申请展示，不代表申请已通过；通过状态从 `onPanelResult` 获取。不要在 `setup` 中等待这个回调才返回，否则无法进入同步阶段。

### 3.3 清理资源

`setup` 可以返回清理函数，返回其他值会导致加载失败。卸载、重载或框架关闭时会等待该函数执行。若同时定义 `teardown`，框架依次调用 setup 的清理函数和 `teardown`，两者都以插件对象作为 `this`。

下面的生命周期片段放在插件的 `setup` 中：

```js
const controller = new AbortController()
const timer = setInterval(() => logger.debug('插件仍在运行'), 60_000)
timer.unref()

return async () => {
  clearInterval(timer)
  controller.abort()
  // 在这里等待自己创建的 worker、请求或其他任务退出。
}
```

框架只会清理自己维护的注册列表，不会自动关闭插件的定时器、worker、独立服务器、文件句柄或直接挂在 `bot` 上的监听器。插件卸载不删除数据库记录；重载后应重新读取持久化状态。

单独加载时如果卡片同步失败，新插件会从注册列表移除并执行清理。重载会先卸载旧插件再加载新插件；新版本失败时不会自动恢复旧版本。正在执行的业务处理也不会因卸载自动取消，长任务需要插件自行协调退出。

## 4. 插件上下文 API

| 字段或函数 | 签名/类型 | 用途 |
| --- | --- | --- |
| `registerCommand` | `registerCommand(options) → command` | 注册一个命令 |
| `onGroupMessage` | `onGroupMessage(async (event, reply) => {})` | 注册群消息处理器 |
| `onC2CMessage` | `onC2CMessage(async (event, reply) => {})` | 注册单聊消息处理器 |
| `onButtonInteraction` | `onButtonInteraction(async event => {})` | 注册按钮互动处理器 |
| `onGroupMemberAdd` | `onGroupMemberAdd(async event => {})` | 注册群成员加入处理器 |
| `registerWebPage` | `registerWebPage({ title, handler }) → urlPrefix` | 申请管理子页面，每个插件只能申请一次 |
| `mysql` | 插件专属数据库对象 | MySQL/SQLite 通用访问，见第 9 节 |
| `uploadTemporaryImage` | `await uploadTemporaryImage(image, options?) → URL` | 通过框架公共图床上传图片 |
| `bot` | 运行中的 SDK Bot 实例 | 访问 QQ SDK 功能 |
| `logger` | 插件专属日志对象 | `debug/info/warn/error/child` |

事件注册函数要求参数是函数，没有单独的注销返回值。一个插件可以注册多个同类处理器，卸载时框架移除该插件全部处理器。

标准启动流程会提供数据库和图床能力。单独构造 `PluginManager` 做测试时，可以注入简化对象；未注入数据库时 `mysql` 可能为 `undefined`，未注入上传函数时调用上传 API 会报错。

## 5. 注册和处理命令

### 5.1 `registerCommand(options)`

| 字段 | 必需 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `name` | 是 | 无 | 去除首尾空白后不能为空，不能包含 `/` 或空白字符 |
| `description` | 是 | 无 | 非空描述，用于官方卡片 |
| `scopes` | 是 | 无 | `'group'`、`'c2c'` 或包含两者的非空数组，重复值会去除 |
| `handler` | 是 | 无 | 函数，接收 `(args, reply, event)` |
| `inCommandPanel` | 否 | `true` | 布尔值，是否申请展示 |
| `priority` | 否 | `'normal'` | 五个固定等级之一 |
| `required` | 否 | `false` | 布尔值，是否必须保留在卡片中 |
| `onPanelResult` | 否 | 无 | 函数，允许异步，接收卡片申请结果 |

命令名称的匹配及冲突检查不区分大小写。`help` 与 `HELP` 不能同时注册，即使二者 scopes 不同；需要两种作用域时在一次注册中填写 `['c2c', 'group']`。没有内置 alias 字段，若要注册多个命令名称，分别注册并复用 handler。

### 5.2 参数解析

框架先对整条消息 `trim()`，去掉命令前可选的一个 `/`，再按第一个空白字符拆分。只匹配消息开头的完整命令名称，不是全文关键词搜索。

| 收到的消息 | 命令名 | `args` |
| --- | --- | --- |
| `问候` | `问候` | `undefined` |
| `/问候` | `问候` | `undefined` |
| `问候 张三` | `问候` | `'张三'` |
| `/问候   张三` | `问候` | `'  张三'`，只去掉第一个分隔空白 |
| `问候 张三 李四` | `问候` | `'张三 李四'` |
| `  /问候 张三  ` | `问候` | `'张三'`，整条消息的首尾空白已移除 |

没有 shell 风格的引号解析，也不会自动按空格把参数拆成数组。根据业务需要自行 `trim()`、`split()` 或解析 JSON。

`handler` 可从 `event` 获取当前用户和群等信息。处理器抛错时框架记录错误，不会自动给用户发送错误提示；需要友好的回复时，在业务代码中捕获错误并调用 `reply`。

## 6. QQ 官方指令卡片与申请回调

### 6.1 筛选规则

所有插件共用 **20 个命令名额**，不是每个插件 20 个，也不是群聊和单聊各选 20 个。同一个命令同时支持两种作用域只占一个名额，入选后投影到相应作用域的官方面板。

筛选按以下顺序进行：

1. 排除 `inCommandPanel: false` 的命令。
2. 检查所有申请展示且 `required: true` 的命令数；超过 20 直接报配置错误，在任何面板查询或写入前终止。
3. 先放入全部必选命令。
4. 其余名额按 `critical → high → normal → low → optional` 填充。
5. 同等级使用插件加载顺序和插件内注册顺序，结果确定，不随机选择。

必选命令内部也按优先级和上述稳定顺序排列。申请总数不超过 20 时全部展示，仍采用这个排列规则。`priority: 'critical'` 优先于普通命令，但只有 `required: true` 才保证不被普通名额淘汰。

默认目录加载按子项名称的 `zh-CN` 排序依次执行，插件内部应使用固定数组或明确排序后的列表注册命令。不要随机排列或由并发请求完成顺序决定注册顺序。手动加载按照操作顺序排列；重载插件会重新进入加载顺序，可能影响同级命令的名额。

例如，已有 3 个必选命令，又有 10 个 high、12 个 normal 申请展示：必选全部保留，10 个 high 全部保留，剩余 7 个名额按稳定顺序选择 normal。其他 normal 命令仍可通过消息调用。

`required: true` 与 `inCommandPanel: false` 互相矛盾，会在注册阶段报错。`priority` 拼写错误、字符串形式的 `'false'` 或数值形式的 required 也会被拒绝。

### 6.2 回调结果

`onPanelResult(result)` 收到以下对象：

```json
{
  "name": "问候",
  "pluginName": "greeting",
  "requested": true,
  "approved": true,
  "priority": "normal",
  "required": false,
  "reason": "approved"
}
```

| 字段 | 含义 |
| --- | --- |
| `requested` | 注册时是否申请加入官方卡片 |
| `approved` | 这次同步中是否通过卡片申请 |
| `priority` / `required` | 规范化后的优先级与必选标记 |
| `reason: 'approved'` | 已通过并完成面板同步 |
| `reason: 'capacity'` | 因 20 个名额限制未入选 |
| `reason: 'not-requested'` | `inCommandPanel: false`，没有申请 |

回调不是紧接在 `registerCommand()` 返回后执行：首次要等待 setup 和卡片同步完成。每次成功同步都会通知当前仍注册的命令，包括其他插件加载、卸载、重载所触发的同步，即使审批结果没变化也会回调。主动关闭卡片的命令也会收到 `approved: false` 的结果。

两个作用域全部同步成功后才执行回调。QQ API 失败或必选数量超限时，同步操作抛错，不发送“通过”通知；远端 API 写入不是跨面板事务，失败前已经完成的某个面板写入可能存在，需要修复后重新同步。

回调按注册列表顺序执行并等待其 Promise。单个回调异常会记录日志，继续通知其他命令，不撤销已同步面板。回调可用于更新内存状态、记录日志或保存数据库状态；不要在其中等待插件 load/unload/reload 或再次调用面板同步，这些操作共用串行队列，可能互相等待。

### 6.3 面板维护

每个作用域最多生成一个由框架管理的 `all` 面板，备注分别为 `qq-plugin-framework:c2c:0` 和 `qq-plugin-framework:group:0`。没有入选命令的作用域会清理旧的框架面板，旧版本拆分产生的多余面板也会删除；不改动其他备注的人工面板。

同步前比较远端内容，未变化时不重复写入。卡片描述按 30 个计数单位截短，ASCII 字符算 1，其他 Unicode 字符算 2，截短时记录警告；这不会改变实际命令的 description 或消息路由。名额不足的命令会逐个记录名称、插件和优先级。

## 7. Markdown 回复和图片上传

### 7.1 `reply(message)`

命令处理器和两种消息处理器都获得 `reply`，返回 Promise，成功后返回 SDK 的发送结果。支持两种输入：

```js
await reply('# 标题\n\n**粗体**、*斜体*、`代码`以及[链接](https://example.com/)')

const { segment } = require('qq-official-bot')
await reply(segment.markdown('> 引用内容'))
```

字符串会自动转换为 Markdown 消息，并开启图片资源校验。普通文本消息段、图片消息段、任意数组或普通对象不被框架的 `reply` 接受。要发送图片，用 `![说明](公网图片地址)` 嵌入 Markdown。

命令处理器的 reply 会附加对原消息的引用；群消息和单聊消息监听器的 reply 默认不附加引用。框架提供的 reply 不接受第二个 options 参数。

最终渲染和发送限制由 QQ 平台决定。网页中能预览某种 Markdown，并不代表 QQ 客户端一定以完全相同的方式显示。涉及用户输入时，根据业务决定是否转义 Markdown 特殊字符。

### 7.2 `uploadTemporaryImage(image, options?)`

| 输入 | 必要选项 | 说明 |
| --- | --- | --- |
| PNG/JPEG Base64 Data URL | 无 | 必须是真实图片内容，不是只修改 MIME 头 |
| `Buffer` | `contentType: 'image/png'` 或 `'image/jpeg'` | 可附 `fileName` |
| HTTP/HTTPS 图片 URL | 无 | 先由框架下载，再上传到公共图床 |

下面是处理器中的片段，`pngBuffer` 为业务已经获得的 PNG Buffer：

```js
const imageUrl = await uploadTemporaryImage(pngBuffer, {
  contentType: 'image/png',
  fileName: 'report.png',
})
await reply(`# 查询结果\n\n![报告](${imageUrl})`)
```

框架可选择 `external`（外部）或 `builtin`（内置）图床，插件的调用方式和返回 URL 的形式不变。外部模式使用框架配置的 `QQBOT_IMAGE_HOST_ORIGIN`、`QQBOT_IMAGE_UPLOAD_URL` 和 `QQBOT_IMAGE_UPLOAD_TOKEN`，根地址与完整上传地址分别配置，框架不再拼接 `/upload.php`。内置模式使用 `QQBOT_WEB_PUBLIC_ROOT` 作为管理页面公网访问根地址，不需要图床 Token；上传内容和过期时间存入当前框架数据库，通过匿名 `/images/*` 路由提供给 QQ 读取，管理与插件页面仍需鉴权。

上述地址、模式和内置保留时间也可以在框架管理页面配置，环境变量优先，重启生效。插件不重复配置图床凭据，也不自行实现上传站点调用。未配置所选模式的必要地址时上传会抛出明确错误。所有输入统一限制为 30 MiB，校验 PNG/JPEG MIME 与文件签名；这不等同于完整图像解码校验。远程下载和外部上传各自默认超时为 10 秒，远程下载流超过上限会停止读取。接收用户图片的插件仍需限制请求体大小，外部服务也可以施加更严格限制。

内置图床默认保留 24 小时，可通过 `QQBOT_IMAGE_RETENTION_HOURS` 或网页的 `imageRetentionHours` 调整；启动和每 10 分钟清理，访问时到期立即 404。已上传图片的过期时间固定，调整配置不修改旧图片。外部服务自行决定清理周期。可参考 [README 图床配置](../README.md#临时图床配置) 和 [外部图床后端协议与独立示例](./external-image-host.md)。

如果插件页面通过 Base64 JSON 上传图片，30 MiB 图片编码后约为 40 MiB，插件的 readBody 上限应至少设为 41 MiB。反向代理也需允许该大小的请求（例如 `client_max_body_size 41m`）；外部图床使用 multipart，请求体上限为 31 MiB。普通管理表单的默认请求上限仍为 1 MiB。

临时图床地址不应被当作永久存储保证。需要长期保留的本地原始文件仍放在 `plugins` 内，业务记录可存数据库。保存 Markdown URL 的插件功能不会自动延长图片寿命或重新上传，长期规则请使用长期托管地址或实现重传机制。

## 8. 消息与通知事件

### 8.1 群聊和单聊消息

在 setup 中注册：

```js
onGroupMessage(async (event, reply) => {
  const groupOpenid = String(event.group_id || event.group_openid || '')
  const content = String(event.raw_message ?? event.content ?? '')
  if (groupOpenid && /^你好$/u.test(content.trim())) {
    await reply('**你好！**')
  }
})

onC2CMessage(async (event, reply) => {
  const content = String(event.raw_message ?? event.content ?? '')
  if (content.trim() === '帮助说明') await reply('请输入 `/问候`。')
})
```

事件原样来自 SDK，框架没有把所有字段统一成一种自定义 DTO。常用字段可按以下顺序读取，缺失时要处理空值：

| 信息 | 常用字段 |
| --- | --- |
| 消息正文 | `event.raw_message ?? event.content` |
| 群 OpenID | `event.group_id || event.group_openid` |
| 消息 ID | `event.message_id || event.id` |
| 用户 OpenID | 常见为 `event.sender?.user_openid`，部分事件使用 `user_id` 或 `author` 对象 |

OpenID 是平台提供的标识，不应假定它就是用户 QQ 号或群号。群名称不一定包含在每条消息中，必要时调用 SDK 的群资料接口补全，并处理无权限或接口失败的情况。

**消息监听器会收到命令消息。** 对同一条消息，命令路由和消息监听器并行执行；监听器不因命令被处理而停止，返回 `false` 也不会阻止其他插件。若注册了 `/问候` 又在监听器中匹配“问候”，两处可能各发送一次回复。

群消息同时从 `message.group` 与 `message.group.at` 接入。同一事件对象，或同群、同消息 ID 的重复投递会去重；消息 ID 去重窗口为 60 秒，缓存最多 1024 项。命令路由和消息监听分别去重，跨进程重启没有去重持久化保证。涉及发奖、扣额度等业务，应另用数据库唯一键做幂等。

同类消息处理器使用 `Promise.allSettled` 并发执行，某个插件失败会记录错误，不阻止其他插件。不要依赖多个处理器的完成先后顺序。

### 8.2 按钮互动

```js
onButtonInteraction(async event => {
  logger.debug('收到按钮互动', event.id)
  // 检查自己业务的按钮标识、群及操作用户，再执行操作。
})
```

来自 SDK 的 `notice.group.action`。框架已发起 `event.reply(0)` 作为互动确认，并把事件传给全部按钮监听器，不等待确认完成才分发。这里没有第二个框架 reply 参数；不要把互动确认接口当成 Markdown 消息发送接口。按钮事件的具体字段及后续发送方法按 SDK 能力处理。

### 8.3 群成员加入

```js
onGroupMemberAdd(async event => {
  logger.info('收到成员加入事件', event.group_id || event.group_openid)
  // 这里接收的是 SDK 的成员通知事件，不保证具有消息 reply 方法。
})
```

来自 `notice.group.member.increase`，只传 event。`GROUP_MEMBER`、互动和全量消息还受 QQ 平台权限控制。通过上下文事件注册函数订阅，便于插件卸载时统一解除注册。

## 9. 数据库 API 与后端兼容

### 9.1 同一个 `mysql` 对象支持两种后端

`mysql` 是兼容保留的 API 名称。在 MySQL 和 SQLite 模式下插件都使用 `mysql.query`、`mysql.execute`、`mysql.transaction`，无需创建自己的连接池或判断当前后端。

框架默认 SQLite，首次启动自动建库。MySQL 由运营者通过框架 `.env` 选择和配置，切换后端不会自动复制另一后端的插件记录。

| API | 返回值/用途 |
| --- | --- |
| `mysql.pluginTable(suffix)` | 已加反引号的本插件表名 |
| `mysql.publicTable(suffix)` | 已加反引号的公共表名 |
| `await mysql.query(sql, values?)` | mysql2 风格的 `[rowsOrResult, fields]` |
| `await mysql.execute(sql, values?)` | mysql2 风格的 `[rowsOrResult, fields]` |
| `await mysql.transaction(async tx => value)` | 提交后返回 value，异常时回滚并抛出 |

插件 `group-notes` 的 `mysql.pluginTable('settings')` 为反引号包围的 `_plugin_group_notes_settings`。suffix 只能包含字母、数字和下划线，插件名称会规范化为小写下划线形式。不同插件名如 `a-b` 和 `a_b` 会得到相同表前缀，命名时避免这种冲突。

插件可访问 `_public_` 和自身 `_plugin_<规范化名称>_` 表，不可访问其他插件的私有表、框架表或其他数据库。公共表允许各插件共同读写，使用前约定字段和并发规则；`publicTable` 只生成表名，不自动建表。

SQL 操作有表名和语句检查，不是插件代码的沙箱。插件不能通过内部属性绕过受限对象访问连接，正常开发只使用上表列出的 API。

### 9.2 初始化与参数化查询

以下片段位于 setup 或插件 store 方法中：

```js
const table = mysql.pluginTable('settings')
await mysql.execute(`CREATE TABLE IF NOT EXISTS ${table} (
  id INT NOT NULL PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
)`)

await mysql.execute(`INSERT INTO ${table} (id, content, updated_at)
  VALUES (?, ?, ?)
  ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = VALUES(updated_at)`,
[1, '欢迎加入群聊', new Date()])

const [rows] = await mysql.query(`SELECT content FROM ${table} WHERE id = ?`, [1])
const content = rows[0]?.content
```

值使用 `?` 占位符。只有由 `pluginTable`/`publicTable` 生成的已校验表名可直接插入 SQL，不能把用户输入拼成表名或查询条件。当前共同接口以位置参数数组为准，不依赖 MySQL 的对象参数或 `??` 标识符占位语法。

查询返回的 rows 是数组。写入返回的结果可读取 `affectedRows` 和 `insertId`；不要用 affectedRows 统一判断“第一次插入还是更新”，不同后端的 UPSERT 计数语义可能不同。SQLite 的 fields 为 `[]`，自增 ID 是数字转换后的结果，不应依赖超出安全整数范围的 ID。

### 9.3 事务

在 setup 中先初始化表，然后在业务处理器中使用事务：

```js
const table = mysql.pluginTable('counters')
await mysql.execute(`CREATE TABLE IF NOT EXISTS ${table} (
  counter_key VARCHAR(191) NOT NULL PRIMARY KEY,
  total INT NOT NULL
)`)

const total = await mysql.transaction(async tx => {
  await tx.execute(`INSERT INTO ${table} (counter_key, total) VALUES (?, 1)
    ON DUPLICATE KEY UPDATE total = total + 1`, ['requests'])
  const [rows] = await tx.query(`SELECT total FROM ${table} WHERE counter_key = ?`, ['requests'])
  return rows[0].total
})
```

MySQL 使用独立池连接的 begin/commit/rollback；SQLite 使用串行队列和 `BEGIN IMMEDIATE`。事务内必须使用回调提供的 `tx`，不要等待外层 `mysql.query/execute`，否则 SQLite 的外层操作会排在当前事务后形成互相等待。当前接口不支持嵌套事务。

事务只涵盖数据库操作，不涵盖 QQ 消息发送或网络请求。保持事务短小，将耗时外部请求放到事务之外，并为需要一致性的业务设计状态或重试机制。

### 9.4 SQLite 的兼容边界

SQLite 适配层处理常用 MySQL 语法，但不是完整 MySQL 引擎：

| 语法或类型 | 当前 SQLite 行为 |
| --- | --- |
| 常用 `VARCHAR`、`TEXT`、`INT`、`DATETIME` | 接受相应声明，但 SQLite 类型及约束语义仍适用 |
| 常见整数 `AUTO_INCREMENT` 建表形式 | 转为 SQLite 自增主键 |
| `ON DUPLICATE KEY UPDATE` / `VALUES(column)` | 转为冲突更新及 excluded 列 |
| `INSERT IGNORE` | 转为 `INSERT OR IGNORE` |
| `FOR UPDATE` | 移除；事务的串行执行承担当前进程的隔离 |
| `NOW()`、`NOW(3)`、`CURRENT_TIMESTAMP(3)` | 转换为 SQLite 时间表达式 |
| `ON UPDATE CURRENT_TIMESTAMP` | 移除，不会自动维护更新时间；更新时显式赋值 |
| 建表内普通 `KEY/INDEX` | 兼容转换时移除，不会自动产生同等索引 |
| 建表内 `UNIQUE KEY/INDEX` | 转为 UNIQUE 约束 |
| `ENUM`、JSON | 接受兼容声明；ENUM 不具备 MySQL 相同的值域限制 |

`Date` 参数在 SQLite 转成 UTC 日期字符串，布尔值转成数字，`undefined` 参数会报错，使用 `null` 表示 SQL 空值。读取声明为 JSON 的列时 SQLite 会解析 JSON，声明为日期类型的直接结果列可转换为 Date；TEXT 内的 JSON 仍需自行 `JSON.parse`。涉及日期比较和展示时在应用层统一时区。

避免 MySQL 专有函数、依赖特定排序规则、复杂 DDL 或依赖 MySQL 隐式类型转换的查询。两种后端都需要验证核心 SQL；仅通过 SQLite 测试不能证明所有 MySQL 行为。

插件 SQL 不允许多语句、数据库管理命令、建视图/触发器等操作，以及框架检查不支持的多表写法。`CREATE INDEX` 也不属于当前插件受限 API 的允许操作。需要更复杂的性能或迁移能力时，应先为框架设计明确的通用接口。

### 9.5 数据迁移

`CREATE TABLE IF NOT EXISTS` 只负责第一次建表，不会自动增加新版本的字段。表结构升级由插件执行可重复的迁移，并把版本记录在自己的插件表中。卸载和重载不会删除这些表，插件更名则会改变私有表前缀，已有数据不会自动改名迁移。

## 10. 网页配置面板 API

### 10.1 注册入口

在 setup 中申请页面：

```js
const prefix = registerWebPage({
  title: '我的插件设置',
  async handler(request, response, web) {
    if (request.method !== 'GET' || request.pluginPath !== '/') {
      return web.sendHtml(response, 404, web.layout('未找到', '<h1>页面不存在</h1>'))
    }
    web.sendHtml(response, 200, web.layout('设置', '<h1>我的插件设置</h1>'))
  },
})
logger.info('插件管理入口', prefix)
```

默认 URL 前缀为 `/plugins/<URL编码后的插件名>`。`title` 显示在页面注册信息中；每个插件只能申请一个 handler，多个页面、JSON API 和静态资源都由这个 handler 在前缀下面分发。

框架会在调用 handler 前验证管理登录会话或 Bearer 令牌。没有登录的请求会重定向到 `/login`；普通访客因此不能直接调用插件管理 API。管理登录不是按群或插件划分的账号权限系统，需要更细权限时由插件增加业务校验。

### 10.2 请求字段

request/response 是 Node.js 的 `http.IncomingMessage` 和 `http.ServerResponse`，request 另有：

| 字段 | 示例 | 含义 |
| --- | --- | --- |
| `request.pluginPath` | `/settings` | 去掉插件 URL 前缀后的路径 |
| `request.pluginUrlPrefix` | `/plugins/message-board` | 分配给插件的前缀 |
| `web.urlPrefix` | `/plugins/message-board` | 同一个前缀，适合构造表单和链接 |
| `web.url` | URL 对象 | 本次请求的解析结果，可读 pathname/searchParams |

插件路径不包含查询参数。框架解析 `web.url` 时用 `http://localhost` 作基准，不要用它的 host/origin 当作浏览器的实际访问域名。需要验证浏览器请求来源时比较请求头 Origin 与 Host，参考完整示例。

同一 handler 可处理 `/`、`/settings`、`/api/...` 和 `/assets/...`。**POST `/plugins/<插件名>/reload` 与 `/unload` 被框架的重载/卸载路由占用**，不要用这两个路径定义插件自己的保存接口。根级 `/plugins/load` 也由框架使用。

### 10.3 `web` 工具

| 工具 | 签名 | 说明 |
| --- | --- | --- |
| `escapeHtml` | `escapeHtml(value) → string` | 转义 `& < > " '`，用于文本和引号包围的 HTML 属性 |
| `layout` | `layout(title, body) → 完整 HTML` | 包含基础管理样式，body 必须自行处理转义 |
| `sendHtml` | `sendHtml(response, status, html, options?)` | 发送 HTML、无缓存头和页面策略 |
| `readBody` | `await readBody(request, { maxBytes }?) → string` | 默认上限 1 MiB，超限拒绝并销毁请求连接 |
| `readForm` | `await readForm(request) → URLSearchParams` | 读取 URL 编码的表单，使用默认请求体上限 |
| `redirect` | `redirect(response, location)` | 发送 303 跳转，适合 POST 保存后返回 GET 页 |

handler 应处理自己支持的 HTTP 方法、路径、输入类型、长度和错误。数据库保存后才返回成功；若还维护内存缓存，同步更新或失效缓存。

需要 JSON 响应时使用原生 response，并设置正确的 Content-Type、Cache-Control 和 `X-Content-Type-Options: nosniff`。如果框架工具未能处理错误，框架外围捕获会记录并显示错误；插件可在 handler 内返回更适合用户理解的错误页面。

### 10.4 脚本、样式与 CSP

默认 `sendHtml` 不允许浏览器脚本执行。交互页面显式开启：

```js
web.sendHtml(response, 200, html, { interactive: true })
```

交互模式允许同源外部脚本、同源 fetch，以及同源/HTTP/HTTPS/data 图片。仍不允许内联 `<script>` 执行、HTML `onclick`、外部 CDN JavaScript 或 eval。脚本放在插件的 `public/app.js`，通过 `/assets/app.js` 提供，页面引用 `${web.urlPrefix}/assets/app.js`。普通和交互模式都允许同源样式文件和内联样式。

静态文件使用明确白名单映射；不要把任意请求路径直接拼成磁盘路径。浏览器只能读取插件主动提供的资源，不应直接提供整个插件目录或包含凭据的数据目录。

若把 JSON 放入 `<script type="application/json">`，先将 JSON 中的 `<` 替换为 `\u003c`，避免用户内容提前闭合 script 元素；普通 HTML 文本使用 `escapeHtml`。`escapeHtml` 不是 URL 协议或 JavaScript 校验函数。

框架的 `Referrer-Policy` 是 `same-origin`。不要为了某个插件改成全局 `no-referrer` 后又直接解析 POST 的 Origin：浏览器可能提交 `Origin: null`。无效 Origin 应返回明确的 403，不应直接让 `new URL` 的 `Invalid URL` 暴露为页面错误。

### 10.5 Markdown 编辑功能

Markdown 编辑器由插件自行实现，脚本和样式放在该插件目录并通过其页面路由提供。框架上下文没有 `registerMarkdownEditor` API，也不附带业务插件的编辑器实现。

需要类似编辑器时，将相应实现放入自己的插件目录，或在后续开发中明确抽取共用组件。回复内容存储在本插件数据库表中，图片仍调用框架 `uploadTemporaryImage`。

## 11. 完整示例：数据库设置与网页面板

以下示例提供 `/公告` 命令，以及管理页面中编辑公告 Markdown 的功能。它使用一个全局公告设置，并不是按群设置；需要按群配置时，把群 OpenID 加入数据主键。

创建 `plugins/message-board/index.js`。此示例无需额外依赖和插件环境变量，使用框架提供的数据库和网页 API。

```js
'use strict'

function verifyOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return // 允许通过既有鉴权的非浏览器客户端。
  let source
  try { source = new URL(origin) } catch {
    throw Object.assign(new Error('请求来源无效，请重新打开页面'), { statusCode: 403 })
  }
  if (!['http:', 'https:'].includes(source.protocol) || source.host !== request.headers.host) {
    throw Object.assign(new Error('请求来源不正确'), { statusCode: 403 })
  }
}

module.exports = {
  name: 'message-board',

  async setup({ mysql, registerCommand, registerWebPage, logger }) {
    const table = mysql.pluginTable('settings')
    await mysql.execute(`CREATE TABLE IF NOT EXISTS ${table} (
      id INT NOT NULL PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL
    )`)
    await mysql.execute(`INSERT INTO ${table} (id, content, updated_at) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE id = VALUES(id)`, [1, '**欢迎使用机器人！**', new Date()])

    async function readContent() {
      const [rows] = await mysql.query(`SELECT content FROM ${table} WHERE id = ?`, [1])
      return rows[0]?.content || '暂时没有公告。'
    }

    registerCommand({
      name: '公告',
      description: '查看当前公告',
      scopes: ['c2c', 'group'],
      inCommandPanel: true,
      priority: 'high',
      required: false,
      onPanelResult({ approved, reason }) {
        logger.info('公告卡片申请结果', { approved, reason })
      },
      async handler(_args, reply) {
        await reply(await readContent())
      },
    })

    registerWebPage({
      title: '公告设置',
      async handler(request, response, web) {
        const route = request.pluginPath.replace(/\/$/u, '') || '/'
        try {
          if (route === '/' && request.method === 'GET') {
            const content = await readContent()
            const body = `<h1>公告设置</h1>
              <form method="post" action="${web.escapeHtml(web.urlPrefix)}/settings">
                <label>公告 Markdown<br>
                  <textarea name="content" rows="12" maxlength="4000" required>${web.escapeHtml(content)}</textarea>
                </label>
                <p><button>保存公告</button></p>
              </form>`
            return web.sendHtml(response, 200, web.layout('公告设置', body))
          }
          if (route === '/settings' && request.method === 'POST') {
            verifyOrigin(request)
            const form = await web.readForm(request)
            const content = String(form.get('content') || '').trim()
            if (!content || content.length > 4000) {
              throw Object.assign(new Error('公告须为 1 到 4000 个字符'), { statusCode: 400 })
            }
            await mysql.execute(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`,
              [content, new Date(), 1])
            return web.redirect(response, web.urlPrefix)
          }
          return web.sendHtml(response, 404, web.layout('未找到', '<h1>页面不存在</h1>'))
        } catch (error) {
          logger.error('公告页面处理失败', error)
          return web.sendHtml(response, error.statusCode || 500,
            web.layout('保存失败', `<h1>保存失败</h1><p>${web.escapeHtml(error.message)}</p>`))
        }
      },
    })
  },
}
```

加载后打开管理首页中 `message-board` 的配置入口，或访问 `/plugins/message-board`。保存后下次发送 `/公告` 立即读取新的数据库内容；重启或重载不会覆盖公告。初始化的 UPSERT 只保留 id，不覆盖已经存在的 content。

需要同时更新多个设置字段时，把保存操作放到事务中。示例没有建立独立 HTTP 服务，也没有在根目录创建配置文件。

## 12. 插件配置和数据存放规则

### 12.1 选择存储方式

| 数据 | 推荐位置 |
| --- | --- |
| 网页面板可修改的设置、群白名单、回复规则 | 本插件 `_plugin_...` 数据库表 |
| 调用计数、待处理任务、恢复状态 | 本插件数据库表，必要时用唯一键和事务 |
| 插件静态词库、模板、配置示例 | `plugins/<插件名>/data/` |
| 本地图片、插件产生的文件缓存 | `plugins/<插件名>/data/` 或自己的子目录 |
| 仅当前进程有效的缓存 | 插件内存，卸载时清理 |
| 多插件明确共同维护的数据 | 约定好的 `_public_...` 表 |

不要在框架 `.env` 中新增 `MY_PLUGIN_TOKEN` 等插件设置，也不要把插件记录写入根目录日志文件。使用上下文 logger 输出运行日志，持久化业务记录通过数据库保存。插件专属服务凭据放在插件目录中的本地配置或插件数据库，不能在管理页、日志或示例文件中输出真实凭据。

### 12.2 读取本地 JSON

目录插件可在 setup 中读取自己的本地文件：

```js
const fs = require('node:fs/promises')
const path = require('node:path')
const configPath = path.join(__dirname, 'data', 'config.json')
let config = { enabled: true }
try {
  config = { ...config, ...JSON.parse(await fs.readFile(configPath, 'utf8')) }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (typeof config.enabled !== 'boolean') throw new TypeError('enabled 必须是布尔值')
```

这里使用入口文件所在的 `__dirname`，不依赖运行时工作目录。配置值需要验证类型、范围和路径，不能因为来源是本地 JSON 就跳过验证。

若保存到文件，先创建自己的 data 目录，再写同目录临时文件，最后 rename 替换；并发保存应串行处理。不要采用相对 `process.cwd()` 的路径，否则容易写到框架目录或部署目录的其他位置。示例配置不包含真实 Token，包含凭据的运行文件由插件开发者添加准确的 Git 忽略规则。

### 12.3 长任务和恢复

内存缓存、setTimeout 或 Map 在重启后会丢失。定时验证、延迟任务等应保存状态和到期时间，setup 时从数据库恢复，清理函数停止当前进程定时器；不要在卸载时把业务记录全部删除。

命令处理器、消息处理器和网页请求可能同时运行。对跨请求共享的“读后写”数据使用数据库事务或原子更新，不依赖 JavaScript 单线程来保证整个异步流程互斥。

## 13. SDK 调用、日志与审计

### 13.1 `bot` 是 SDK 对象

上下文 bot 是运行中的 `qq-official-bot` Bot 实例。需要官方群资料时，可通过 SDK 调用：

```js
try {
  const info = await bot.getGroupInfo(groupOpenid)
  logger.info('群资料查询完成', { groupOpenid, groupName: info?.group_name })
} catch (error) {
  logger.warn('暂时无法获取群资料', error.message)
}
```

这个片段位于已经取得 groupOpenid 的业务函数中。具体 SDK 方法、返回字段、事件类型和 QQ 权限以安装的 SDK 实现及声明为准，框架并没有封装成统一业务模型。接口不可用时保留已有 OpenID 或已有信息，避免把一次失败误当作群不存在。

群资料等高频请求应缓存、限制并发，并设置合理超时。CPU 密集的正则匹配等工作应放入插件自行管理的 Worker，并在卸载时终止 Worker。不要阻塞事件循环，否则其他插件和管理页面会一起受到影响。

使用 `bot.on()` 直接添加监听时，必须在清理函数中以同一个 handler 解除。已经有上下文注册函数的事件优先通过框架注册，避免重复订阅。通过 SDK 直接发消息不自动经过框架 reply 的格式限制和回复审计。

### 13.2 日志

```js
logger.debug('缓存命中', { groupOpenid })
logger.info('规则已保存', { ruleId })
logger.warn('群资料查询失败，继续使用缓存')
logger.error('处理消息失败', error)
```

这些是业务函数内的调用片段，变量由业务提供。logger 自动带框架和插件前缀；`logger.child('模块名')` 可创建子模块日志。当前 logger 的 `debug()` 会输出到控制台，不是一个根据配置自动关闭的日志等级过滤器。

### 13.3 自动审计的范围

框架通过 `_framework_call_log` 记录命令调用、群聊/单聊消息监听器调用，以及通过对应 reply 发送的 Markdown。一次调用和它的回复使用 correlation_id 关联，保存作用域、插件、命令或事件名、用户、群、消息 ID、内容、详情以及发送状态或发送错误。

`onGroupMessage` 和 `onC2CMessage` 的事件名分别记录为 `[group-message-event]` 和 `[c2c-message-event]`。一个事件被多个插件处理时会有各自的调用记录。按钮和成员加入通知没有同样的自动调用审计流程，插件需自行维护所需业务记录。

审计包含收到的消息内容、事件详情和回复内容；它不自动脱敏。不要依赖“只输出在回复里就不会存数据库”的假设。审计记录失败会记日志，框架通常继续执行业务或发送。

## 14. 加载、重载与调试

### 14.1 管理方式

| 方式 | 操作 |
| --- | --- |
| 启动自动加载 | 在默认 plugins 中放入有效入口，再启动框架 |
| 管理首页 | 加载路径、重载、卸载及打开插件配置页 |
| 交互式终端 | `plugins`、`load <路径>`、`reload <插件名>`、`unload <插件名>`、`help` |
| 框架集成代码 | `framework.plugins.load(path)` / `.reload(name)` / `.unload(name)` |

console 只在交互式 TTY 且 `QQBOT_CONSOLE` 不为 `0` 时启用。load 使用路径，reload/unload 使用插件名；例如 `load plugins/greeting` 与 `reload greeting`（需先按本文创建插件）。

列表 API：`listPlugins()` 返回名称、入口路径、命令数量、各类处理器数量和 configUrl；`listCommands()` 返回全部已注册命令，包括未进入卡片的命令；`findCommand(scope, name)` 可查找实际可执行命令。`listCommands()` 中没有自动回填 approved 字段，插件应从自己的 `onPanelResult` 保存需要展示的状态。

### 14.2 热重载的边界

重载先重新检查依赖。依赖未变时复用 node_modules；依赖重装后清理该插件目录内的 CommonJS 依赖缓存，重新加载新版本，不清理其他插件的独立依赖。卸载不删除依赖；删除整个插件目录无需清理框架根依赖。

ESM 入口以新代次 URL 重新执行，入口引用的 ESM 子模块仍受 Node 缓存限制；修改 ESM 子模块/依赖或模块类型时应重启进程。目录外的共享模块、主框架或 SDK 变化也应重启。未结束的业务调用可能仍引用旧代码，清理函数须自行协调。

浏览器静态资源更新后重新加载页面。文件系统模块重载与浏览器缓存是两个不同环节，不要只重载后端插件就认为已有浏览器页面会自动更新。

框架没有文件监听器、自动 schema 迁移或插件打包发布系统。交互终端操作与管理页面操作会通过插件管理队列串行执行，但业务消息和 HTTP 请求仍可能并发运行。

## 15. 测试插件

### 15.1 最小单元测试

先创建第 2 节的 greeting 插件，再保存下例为 `test/greeting.test.cjs`。此测试只注入插件所需上下文，不连接 QQ，也不申请真实卡片。

```js
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const plugin = require('../plugins/greeting')

test('问候插件注册命令并按参数回复', async () => {
  const commands = []
  await plugin.setup({
    registerCommand(options) { commands.push(options); return options },
    logger: { info() {} },
  })
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, '问候')
  const replies = []
  await commands[0].handler(undefined, async message => replies.push(message), {})
  await commands[0].handler('张三', async message => replies.push(message), {})
  assert.deepEqual(replies, ['**你好，朋友！**', '**你好，张三！**'])
})
```

运行：

```powershell
node --test test/greeting.test.cjs
npm run check
```

这个单元测试的 reply 是 mock，验证业务文本。实际集成测试还要检查框架转换后的消息段和引用行为。

### 15.2 集成测试应覆盖什么

- 用真实 SQLite 服务初始化本插件表，验证新增、查询、修改、删除和事务回滚。
- 重建插件实例或重载后仍能读到已有设置，不覆盖历史业务数据。
- 使用 mock Bot 的 `getCommandPanels/createCommandPanel/updateCommandPanel/deleteCommandPanel` 测试真实同步器，不发送真实 QQ 请求。
- 验证 `inCommandPanel: false`、名额不足、必选超限和优先级相同的顺序。
- 检查 onPanelResult 的 true/false、reason、再次分配名额，以及回调异常。
- 模拟消息事件的 `reply`，确认 Markdown 输出，检查一条命令是否又被消息监听器重复回复。
- 用本机端口 0 的 WebAdminServer 测试登录、cookie、页面、保存、无效输入和不正确来源。
- 对业务相关的 MySQL SQL 使用真实测试数据库验证，不把 SQLite 测试结果当成 MySQL 全覆盖。

数据库测试不要用生产连接；测试库属于数据库存储。其他持久化插件测试文件放在插件自己的测试目录并及时清理。图床函数可通过 PluginManager 的 uploadTemporaryImage 注入 mock。

现有参考测试：`test/plugin-manager.test.js`、`test/command-panel-selection.test.js`、`test/command-panel-sync.test.js`、`test/framework-events.test.js`、`test/sqlite.test.js` 和 `test/web-admin.test.js`。发行版只保留框架测试，测试中临时创建的插件仅用于验证加载、上下文和生命周期，不会安装到发行版的 plugins 目录。

独立依赖测试见 `test/plugin-dependencies.test.js` 和 `test/plugin-dependencies.integration.test.js`。前者 mock npm，后者真实安装临时本地包且禁止联网，验证 require/import 都从插件自己的 node_modules 解析。可运行 `npm run smoke` 启动真实框架、SQLite 和 Web 服务，以模拟 QQ 事件验证旧插件、依赖失败隔离及生命周期。

## 16. 常见问题

| 现象 | 检查和处理 |
| --- | --- |
| 插件没有自动加载 | 是否为 plugins 的直接子项；名称是否以 `_` 或 `.` 开头；目录是否有 Node 可解析入口；setup 是否报错 |
| 插件依赖安装失败或被跳过 | 检查日志中的插件路径和 npm 操作；在该目录手动运行命令，检查 Node/npm、网络、锁文件、磁盘和权限 |
| 自动安装关闭后插件无法加载 | 在插件目录执行 npm ci --omit=dev（无锁用 npm install --omit=dev），再 load；不要在框架根目录安装 |
| 插件名意外为 index | 在导出对象上显式填写唯一的 name |
| 命令冲突但 scopes 不同 | 命令名全局不区分大小写，合并为一个命令注册两种 scopes |
| 命令能用但卡片没有 | 看 inCommandPanel、onPanelResult.reason 和名额淘汰日志；消息路由独立于卡片 |
| 所有 required 命令导致加载失败 | 申请展示的必选命令总数必须不超过 20，调整其他命令为普通优先级 |
| 回调一直没执行 | setup 必须先完成；检查同步是否失败；直接调用 setup 的单元测试不会自动执行同步回调 |
| 一条消息收到两次回复 | 检查命令 handler 与消息监听器是否都匹配，或多个回复组/插件是否同时触发 |
| 命令 handler 的 args 多了空格 | 解析只去掉第一个分隔字符，按业务需要 trim；无参数为 undefined |
| 没有收到全量群消息或成员事件 | 检查账号 QQ 平台权限和事件投递；框架注册处理器不能创建平台权限 |
| 群名称为空 | 消息未包含名称或群资料 API 无权限，先保留 OpenID；查询失败不要删除规则 |
| 插件 SQL 无权访问数据表 | 用 pluginTable/publicTable 生成表名，不能访问其他插件或框架表 |
| SQLite 事务卡住 | 事务内部是否等待了外层 mysql 操作，或嵌套事务；全部改用 tx |
| 保存后 updated_at 不变 | 显式 UPDATE updated_at；SQLite 不会模拟 MySQL 的自动 ON UPDATE 时间戳 |
| 网页脚本不执行 | sendHtml 是否开启 interactive；使用同源外部脚本，不写内联 onclick/script |
| 点击保存/刷新显示 Invalid URL | 检查 Origin 解析及 Referrer-Policy，不把 null Origin 直接传给 new URL；重新加载页面 |
| 管理 API 返回登录页而不是 JSON | 当前会话失效或未鉴权；浏览器 fetch 会跟随登录跳转，客户端应检查内容类型 |
| 图片上传失败 | 外部模式检查根地址、完整上传地址和 Token；内置模式检查管理公网根地址；两种模式都检查 PNG/JPEG 内容、大小与网络超时 |
| 重载后仍有旧定时器或处理器 | 补齐 cleanup，直接 bot.on 的监听器要 bot.off；检查未结束的旧请求 |
| 改共享模块后重载没生效 | 修改目录外依赖后重启进程 |
| 更名后业务数据消失 | 更名改变私有表前缀，原表还在，需要显式数据迁移 |

## 17. 源码索引与发布检查

### 17.1 核心源码

以下链接相对于本开发文档：

| 内容 | 文件 |
| --- | --- |
| 插件导出、上下文、加载与清理 | [src/plugin-manager.js](../src/plugin-manager.js) |
| 独立 npm 安装、完整性检查与 hash 状态 | [src/plugin-dependencies.js](../src/plugin-dependencies.js) |
| 命令参数解析及 reply | [src/command-router.js](../src/command-router.js) |
| 卡片配置验证与 20 个名额筛选 | [src/command-panel-selection.js](../src/command-panel-selection.js) |
| 官方面板同步及结果回调 | [src/command-panel-sync.js](../src/command-panel-sync.js) |
| 群消息去重、通知及启动/关闭 | [src/framework.js](../src/framework.js) |
| 受限数据库对象和 MySQL | [src/mysql.js](../src/mysql.js) |
| SQLite 适配和事务 | [src/sqlite.js](../src/sqlite.js) |
| 后端选择 | [src/database.js](../src/database.js) |
| 管理鉴权、路由、HTML/表单工具 | [src/web-admin.js](../src/web-admin.js) |
| 图片上传 | [src/temporary-image-host.js](../src/temporary-image-host.js) |
| 自动调用和回复审计 | [src/call-audit-log.js](../src/call-audit-log.js) |
| 日志及交互式终端 | [src/logger.js](../src/logger.js)、[src/console-control.js](../src/console-control.js) |

### 17.2 发布前检查

1. 插件名、规范化数据库前缀及命令名没有冲突。
2. 命令卡片开关、priority 和 required 明确，支持名额不足时仍通过消息调用。
3. 回调不等待同一管理队列中的 load/reload/unload，不阻塞后续同步。
4. 配置和业务文件都在 plugins 内，持久化记录在数据库，不修改框架 .env。
5. 数据库初始化和升级可重复执行；事务内部使用 tx；必要时验证两种后端。
6. 管理页转义用户内容，校验保存输入和来源，静态资源采用白名单。
7. 错误路径、重载、清理和重启恢复经过验证。
8. 文档和配置示例不包含真实凭据，日志及自动审计内容符合业务预期。
9. 运行依赖仅声明在本插件清单，提交锁文件；不提交 node_modules 或依赖状态，审核第三方安装脚本。

本文示例是开发参考，不会在写入这份文档时自动创建或加载新插件。实际部署只加入你明确需要的业务插件。
