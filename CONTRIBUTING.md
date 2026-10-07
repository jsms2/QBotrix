# 贡献指南

感谢参与 QBotrix。提交问题前请搜索已有 [Issues](https://github.com/jsms2/QBotrix/issues)，安全问题按 [SECURITY.md](./SECURITY.md) 私下报告。

## 本地开发

使用 Node.js 22.13 或更高版本：

```bash
git clone https://github.com/jsms2/QBotrix.git
cd QBotrix
npm ci
npm test
npm run check
```

测试不需要真实 QQ 凭据或 MySQL 服务。需要实际运行机器人时，复制 `.env.example` 为 `.env` 并按 README 填写配置。

## 提交变更

1. Fork 仓库，从 `main` 创建描述用途的分支。
2. 保持现有 CommonJS 风格：两空格缩进、单引号、无分号。
3. 行为修复或新功能应提供有意义的测试，并同步更新相关文档；依赖变更同时提交 `package-lock.json`。
4. 运行 `npm test` 和 `npm run check` 后发起 Pull Request，说明问题、变更效果和验证结果。

请保持一次 PR 聚焦一个问题。不要提交 `.env`、数据库、审计记录、日志、个人数据、访问令牌或生成缓存。报告问题时填写 Node.js 版本、系统、脱敏配置和最小复现步骤。业务插件开发请参考 [插件开发文档](./docs/plugin-development.md)。

## 许可

提交贡献表示你有权提供这些内容，并同意以本项目的 `GPL-3.0-only` 协议发布贡献。引入第三方代码时保留原始版权与许可证，并说明来源；依赖清单变更时更新 `THIRD_PARTY_NOTICES.md`。
