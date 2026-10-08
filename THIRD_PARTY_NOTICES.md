# 第三方依赖说明

QBotrix 自有代码使用 GPL-3.0-only。通过 npm 安装的第三方软件保留其原有版权和许可证，不因本项目的许可证而重新许可。

以下清单来自 v1.1.0 的 `package-lock.json`，包含直接和间接依赖；同名包的不同版本分别列出。源码与完整许可证请查看 npm 包链接、其源码仓库及安装后的包内 LICENSE / NOTICE 文件。再分发包含这些依赖的构建或安装包时，应保留上游要求的版权、许可和 NOTICE 文本。

直接依赖为 `mysql2` 和 `qq-official-bot`；QBotrix 未将第三方源码复制到自己的源码文件中。

新增的独立依赖示例另使用 [dayjs 1.11.18](https://www.npmjs.com/package/dayjs/v/1.11.18)，许可证 MIT，由示例自己的 package-lock.json 锁定，不属于框架根依赖。其他插件的第三方依赖由各插件作者提供相应许可说明。

| npm 包 | 锁定版本 | 许可证（包元数据） |
| --- | --- | --- |
| [@noble/curves](https://www.npmjs.com/package/@noble/curves/v/1.9.7) | 1.9.7 | MIT |
| [@noble/hashes](https://www.npmjs.com/package/@noble/hashes/v/1.8.0) | 1.8.0 | MIT |
| [@types/node](https://www.npmjs.com/package/@types/node/v/26.4.0) | 26.4.0 | MIT |
| [agent-base](https://www.npmjs.com/package/agent-base/v/6.0.2) | 6.0.2 | MIT |
| [asynckit](https://www.npmjs.com/package/asynckit/v/0.4.0) | 0.4.0 | MIT |
| [aws-ssl-profiles](https://www.npmjs.com/package/aws-ssl-profiles/v/1.1.2) | 1.1.2 | MIT |
| [axios](https://www.npmjs.com/package/axios/v/1.20.0) | 1.20.0 | MIT |
| [call-bind-apply-helpers](https://www.npmjs.com/package/call-bind-apply-helpers/v/1.0.2) | 1.0.2 | MIT |
| [combined-stream](https://www.npmjs.com/package/combined-stream/v/1.0.8) | 1.0.8 | MIT |
| [date-format](https://www.npmjs.com/package/date-format/v/4.0.14) | 4.0.14 | MIT |
| [debug](https://www.npmjs.com/package/debug/v/4.4.3) | 4.4.3 | MIT |
| [delayed-stream](https://www.npmjs.com/package/delayed-stream/v/1.0.0) | 1.0.0 | MIT |
| [dunder-proto](https://www.npmjs.com/package/dunder-proto/v/1.0.1) | 1.0.1 | MIT |
| [es-define-property](https://www.npmjs.com/package/es-define-property/v/1.0.1) | 1.0.1 | MIT |
| [es-errors](https://www.npmjs.com/package/es-errors/v/1.3.0) | 1.3.0 | MIT |
| [es-object-atoms](https://www.npmjs.com/package/es-object-atoms/v/1.1.2) | 1.1.2 | MIT |
| [es-set-tostringtag](https://www.npmjs.com/package/es-set-tostringtag/v/2.1.0) | 2.1.0 | MIT |
| [flatted](https://www.npmjs.com/package/flatted/v/3.4.4) | 3.4.4 | ISC |
| [follow-redirects](https://www.npmjs.com/package/follow-redirects/v/1.16.0) | 1.16.0 | MIT |
| [form-data](https://www.npmjs.com/package/form-data/v/4.0.6) | 4.0.6 | MIT |
| [formdata-node](https://www.npmjs.com/package/formdata-node/v/6.0.3) | 6.0.3 | MIT |
| [fs-extra](https://www.npmjs.com/package/fs-extra/v/8.1.0) | 8.1.0 | MIT |
| [function-bind](https://www.npmjs.com/package/function-bind/v/1.1.2) | 1.1.2 | MIT |
| [generate-function](https://www.npmjs.com/package/generate-function/v/2.3.1) | 2.3.1 | MIT |
| [get-intrinsic](https://www.npmjs.com/package/get-intrinsic/v/1.3.0) | 1.3.0 | MIT |
| [get-proto](https://www.npmjs.com/package/get-proto/v/1.0.1) | 1.0.1 | MIT |
| [gopd](https://www.npmjs.com/package/gopd/v/1.2.0) | 1.2.0 | MIT |
| [graceful-fs](https://www.npmjs.com/package/graceful-fs/v/4.2.11) | 4.2.11 | ISC |
| [has-symbols](https://www.npmjs.com/package/has-symbols/v/1.1.0) | 1.1.0 | MIT |
| [has-tostringtag](https://www.npmjs.com/package/has-tostringtag/v/1.0.2) | 1.0.2 | MIT |
| [hasown](https://www.npmjs.com/package/hasown/v/2.0.4) | 2.0.4 | MIT |
| [https-proxy-agent](https://www.npmjs.com/package/https-proxy-agent/v/5.0.1) | 5.0.1 | MIT |
| [iconv-lite](https://www.npmjs.com/package/iconv-lite/v/0.7.3) | 0.7.3 | MIT |
| [is-property](https://www.npmjs.com/package/is-property/v/1.0.2) | 1.0.2 | MIT |
| [jsonfile](https://www.npmjs.com/package/jsonfile/v/4.0.0) | 4.0.0 | MIT |
| [log4js](https://www.npmjs.com/package/log4js/v/6.9.1) | 6.9.1 | Apache-2.0 |
| [long](https://www.npmjs.com/package/long/v/5.3.2) | 5.3.2 | Apache-2.0 |
| [lru.min](https://www.npmjs.com/package/lru.min/v/1.1.4) | 1.1.4 | MIT |
| [math-intrinsics](https://www.npmjs.com/package/math-intrinsics/v/1.1.0) | 1.1.0 | MIT |
| [mime-db](https://www.npmjs.com/package/mime-db/v/1.52.0) | 1.52.0 | MIT |
| [mime-types](https://www.npmjs.com/package/mime-types/v/2.1.35) | 2.1.35 | MIT |
| [ms](https://www.npmjs.com/package/ms/v/2.1.3) | 2.1.3 | MIT |
| [mysql2](https://www.npmjs.com/package/mysql2/v/3.24.2) | 3.24.2 | MIT |
| [named-placeholders](https://www.npmjs.com/package/named-placeholders/v/1.1.6) | 1.1.6 | MIT |
| [proxy-from-env](https://www.npmjs.com/package/proxy-from-env/v/2.1.0) | 2.1.0 | MIT |
| [qq-official-bot](https://www.npmjs.com/package/qq-official-bot/v/1.3.0) | 1.3.0 | MIT |
| [rfdc](https://www.npmjs.com/package/rfdc/v/1.4.1) | 1.4.1 | MIT |
| [safer-buffer](https://www.npmjs.com/package/safer-buffer/v/2.1.2) | 2.1.2 | MIT |
| [sql-escaper](https://www.npmjs.com/package/sql-escaper/v/1.5.1) | 1.5.1 | MIT |
| [streamroller](https://www.npmjs.com/package/streamroller/v/3.1.5) | 3.1.5 | MIT |
| [undici-types](https://www.npmjs.com/package/undici-types/v/8.3.0) | 8.3.0 | MIT |
| [universalify](https://www.npmjs.com/package/universalify/v/0.1.2) | 0.1.2 | MIT |
| [ws](https://www.npmjs.com/package/ws/v/8.21.3) | 8.21.3 | MIT |
