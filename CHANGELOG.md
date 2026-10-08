# 更新日志

版本号遵循语义化版本格式，Git 标签使用 `v<版本号>`。

## [1.1.0] - 2026-10-08

- 支持插件独立 package.json、package-lock.json 和 node_modules，保留无清单旧插件兼容性。
- 支持 SHA-256 状态检测、按需 npm install/ci、缺包与失败重试，以及清单/锁文件变化后的依赖更新。
- 增加 `plugins.autoInstallDependencies` 统一配置和 Web 管理开关，默认开启；关闭时显示手动安装命令。
- 同一插件并发安装去重，不同插件并行准备依赖；依赖失败跳过对应插件，继续加载其他插件。
- 支持 ESM default 插件与独立 import，依赖重装时刷新插件 CommonJS 缓存。
- 统一插件真实路径，兼容 Windows 短路径和目录别名，保证依赖更新后的缓存刷新。
- 增加 dayjs 独立依赖示例、离线真实 npm 集成测试与框架 smoke 检查，同步插件 API、安装和安全文档。

## [1.0.0] - 2026-10-07

QBotrix 首次公开发布。

- QQ 官方机器人单聊、群聊命令路由与消息去重。
- 插件加载、卸载、重载，消息、互动与群成员加入事件回调。
- 指令面板同步，支持优先级、必选项与申请结果回调。
- SQLite / MySQL 存储、插件表访问限制及调用和回复审计。
- 带登录鉴权的 Web 管理页面和交互式控制台。
- 内置 / 外部临时图床与独立 Node.js、PHP 外部图床示例。
- 插件开发文档、框架测试及跨平台 GitHub Actions 自动检查。
- 使用 GPL-3.0-only 协议，不预装业务插件。
- 将传输层的 Axios 依赖固定到 1.20.0，修复开源前依赖审计发现的已知漏洞。

[1.1.0]: https://github.com/jsms2/QBotrix/releases/tag/v1.1.0
[1.0.0]: https://github.com/jsms2/QBotrix/releases/tag/v1.0.0
