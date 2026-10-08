# 插件独立依赖示例

此示例扩展问候插件的开发方式，使用小型 `dayjs` 包实现“日期”命令。包仅声明在本插件的 `package.json` 和 `package-lock.json` 中，框架根目录没有此依赖。

复制整个 `independent-dependencies` 目录到 `plugins/independent-dependencies`，启动框架或执行：

```text
load plugins/independent-dependencies
```

默认入口 `index.js` 使用 ESM：`import dayjs from 'dayjs'`。框架先在插件目录运行 `npm ci --omit=dev`，随后加载入口；再次加载且依赖状态未变时不会重复安装。入口验证 `dayjs` 确实位于自己的 `node_modules`，而不是从框架目录回退解析。机器人可响应 `日期` 或 `/日期`。

CommonJS 版本见 `index.cjs`，使用 `require('dayjs')`。需要切换时将插件 `package.json` 的 `main` 改为 `index.cjs`，然后重载插件。两种入口导出相同插件名，不应同时加载。

开发时添加依赖应进入插件目录：

```bash
cd plugins/independent-dependencies
npm install dayjs
```

提交清单和锁文件，忽略 `node_modules/` 和 `.qbotrix-dependencies.json`。依赖状态文件由框架生成。卸载不删除依赖；删除插件目录即可同时删除其依赖和状态。

只应安装可信来源的插件。自动安装允许执行第三方 `preinstall/install/postinstall` 脚本；可在框架配置中设置 `plugins.autoInstallDependencies: false`，自行安装并审核依赖。完整原理、配置及排错见 [插件依赖管理](../../../docs/plugin-dependencies.md)。示例不会自动部署到默认插件目录。
