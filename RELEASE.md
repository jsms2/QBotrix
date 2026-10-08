# QBotrix 发布说明

## v1.1.0 · 2026-10-08

插件支持自己的 npm 清单、锁文件和 node_modules；加载前按状态安装，失败插件跳过。统一配置 `plugins.autoInstallDependencies` 默认开启，可在管理页关闭。完整行为和脚本风险见 [插件依赖管理](./docs/plugin-dependencies.md)。可运行 dayjs 示例位于 `examples/plugins/independent-dependencies`，不会预装到 plugins；打包时保留其清单和锁文件，不包含 node_modules、`.qbotrix-dependencies.json` 或运行数据。

本版本新增插件独立依赖管理，保持无清单旧插件和原有上下文 API 兼容。新增 ESM default 导出及独立 import 支持；同一插件的安装任务去重，不同插件并行准备依赖。完整更新见 [CHANGELOG.md](./CHANGELOG.md)。

验证包含 57 项测试、JavaScript 语法检查及框架 smoke。真实 npm 集成测试仅安装离线临时包；smoke 启动 SQLite/Web 并使用模拟 QQ 事件，不包含真实 QQ 平台联调。

升级后自动安装依赖默认开启，允许 npm 安装脚本执行，仅加载可信插件；需要人工审核时设置 `plugins.autoInstallDependencies: false`。ESM 子模块或依赖更新后应重启整个进程。同一目录的安装去重限同一进程，不应让多个机器人进程共享可写插件目录。

## v1.0.0 · 2026-10-07

QBotrix 首次开源发布，采用 GPL-3.0-only。功能变更见 [CHANGELOG.md](./CHANGELOG.md)。

- 面向 QQ 官方机器人单聊与群聊，包含插件框架、开发文档、测试和外部图床独立示例。
- 不预装业务插件，`plugins/.gitkeep` 用于在 Git 中保留默认插件目录。
- Node.js 要求 >=22.13，使用 `npm ci` 安装锁定依赖。
- 复制 `.env.example` 为 `.env`，填写 `QQBOT_APPID`、`QQBOT_SECRET` 和至少 16 字符的 `QQBOT_WEB_TOKEN` 后运行 `npm start`。
- 默认使用 SQLite，首次启动创建数据库；首次运行加载 0 个插件。
- 图床支持内置或外部模式，图片上限 30 MiB；按 README 配置必要地址。
- 不包含真实凭据、业务数据、数据库、缓存、日志或 node_modules。

## 目录与文件

| 路径 | 用途 |
| --- | --- |
| src/ | 框架生命周期、命令路由、插件管理、数据库、审计、Web 管理与图床 |
| plugins/ | 默认插件目录，仅保留 .gitkeep |
| test/ | 框架行为测试，不连接真实 QQ 或 MySQL 服务 |
| scripts/check.js | JavaScript 语法检查 |
| scripts/smoke.js | SQLite/Web、消息路由、旧插件及依赖失败隔离的 smoke 检查 |
| docs/ | 插件 API、开发指南与外部图床协议 |
| docs/plugin-dependencies.md | 插件独立依赖架构、安装配置、安全边界与排错 |
| examples/plugins/independent-dependencies/ | 小型 dayjs 依赖的 ESM / CommonJS 示例 |
| examples/external-image-host/ | 可独立运行的 Node.js / PHP 图床示例 |
| .github/ | 跨平台 CI、Issue 与 Pull Request 模板 |
| .env.example | 不含真实凭据的配置模板 |
| .gitignore / .gitattributes / .editorconfig | 运行文件忽略与统一文本格式 |
| package.json / package-lock.json | 项目元数据、脚本和锁定依赖 |
| README.md | 安装、配置与使用说明 |
| LICENSE | GNU GPL version 3 完整许可文本 |
| THIRD_PARTY_NOTICES.md | 锁定的第三方依赖与许可证清单 |
| CHANGELOG.md | 版本记录 |
| CONTRIBUTING.md / SECURITY.md | 贡献流程与私下报告漏洞方式 |
| RELEASE.md | 本发布说明与维护者发布步骤 |

直接依赖为 mysql2 与 qq-official-bot。框架启动初始化调用审计表，内置图床另建图片表；插件业务表由插件自行管理。测试中的临时插件不随发行版预装。

## 维护者发布步骤

1. 更新 `package.json` 和 `package-lock.json` 中的版本号，补充 CHANGELOG；依赖变更时更新第三方依赖清单。
2. 使用干净的工作区安装依赖并验证：

   ```bash
   npm ci --ignore-scripts
   npm run check
   npm test
   npm run smoke
   npm audit --omit=dev
   git diff --check
   ```

3. 检查提交内容和忽略规则，确认没有凭据、数据库、日志、缓存或用户数据。
   示例插件的锁文件一同提交，独立 node_modules 和依赖状态必须忽略；逐插件审核依赖和安装脚本。根目录 npm audit 不涵盖各插件依赖。
4. 将所有发布内容提交并推送到 `main`，检查该提交的 GitHub Actions 通过后，为同一提交创建附注标签并推送（后续发布替换版本号）：

   ```bash
   git push origin main
   git tag -a v1.1.0 -m "QBotrix v1.1.0"
   git push origin v1.1.0
   ```

5. 在 GitHub 为标签创建 Release，使用对应版本的更新日志作为说明；GitHub 自动提供源码归档。不要上传含有 `.env`、node_modules 或运行数据库的本机目录打包文件。

当前 `package.json` 的 `private: true` 用于防止意外发布到 npm，不影响 GitHub 开源、克隆、安装或依照 GPL 再分发。
