# 外部临时图床：后端协议、逻辑与独立示例

本文说明如何给本框架提供外部临时图床。后端可以独立部署，不依赖 QQ 机器人、插件目录或框架数据库。示例代码放在 `examples/external-image-host`，只需复制对应的 `node` 或 `php` 目录即可运行。

框架中的两种模式与环境变量见 [README 临时图床配置](../README.md#临时图床配置)。本文的服务用于 `QQBOT_IMAGE_HOST_MODE=external`；内置模式由框架数据库和管理服务提供图片，不需要部署本示例。

## 1. 框架和后端如何配合

1. 插件调用 `uploadTemporaryImage(image, options)`，调用方式与原来一致。
2. 框架把输入转换为 PNG/JPEG Buffer。远程 URL 先下载，不会把 URL 字符串交给后端处理。
3. 框架向配置的完整 `QQBOT_IMAGE_UPLOAD_URL` 发送 multipart POST，使用 Bearer Token 鉴权。
4. 后端验证请求和图片，将内容保存到私有存储，生成不包含原文件名的随机图片路径和固定过期时间。
5. 后端返回纯文本图片相对路径。
6. 框架将 `QQBOT_IMAGE_HOST_ORIGIN` 和相对路径组合成公网 URL，插件将此 URL 放入 Markdown。
7. QQ 通过匿名 GET 读取图片。后端判断是否过期，并在后台自动清理过期内容。

上传地址和图片根地址可以属于不同域名，后端负责保证二者访问同一份图片存储。框架没有默认站点，也不会在根地址后自动添加 `/upload.php` 或任何其他上传路径。

## 2. 上传协议

### 2.1 请求

```http
POST /你配置的上传路径 HTTP/1.1
Authorization: Bearer 你的上传令牌
Content-Type: multipart/form-data; boundary=客户端自动生成
```

multipart 只有一个名为 `image` 的文件字段：

| 项目 | 要求 |
| --- | --- |
| 字段名 | `image` |
| MIME | `image/png` 或 `image/jpeg` |
| 文件大小 | 非空，最多 30 MiB（30 × 1024 × 1024 字节） |
| 文件名 | 不可信；后端应忽略它，使用自己的随机文件名 |
| 鉴权 | 服务端校验 `Authorization: Bearer ...`；令牌由框架环境变量提供 |

框架使用 FormData 自动设置 boundary，不额外发送 JSON、过期时间或机器人凭据。示例将整个 multipart 请求上限设为 31 MiB，为字段头部预留空间；文件自身仍限制为 30 MiB。

服务端应先完成鉴权，再保存图片。MIME、扩展名都不能单独作为图片真实性依据，应检查实际内容。示例 Node 程序检查 PNG 签名、IHDR 和 IEND，或 JPEG 起止标记；PHP 程序结合 Fileinfo 和 `getimagesize` 检查类型和图片头。两者都没有执行完整图像解码或重新编码。需要更严格校验时可以加入受资源限制的图像解码步骤；PHP 官方也明确说明 [`getimagesize` 不能单独作为图片有效性验证](https://www.php.net/manual/en/function.getimagesize.php)。

### 2.2 成功响应

返回任意成功 HTTP 状态码（示例使用 201），正文为纯文本：

```http
HTTP/1.1 201 Created
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store

/images/1790000000000-0123456789abcdef0123456789abcdef.png
```

框架会 trim 正文，并接受 `/images/<文件名>.<扩展名>` 的形式，文件名只能包含字母、数字、点、下划线、短横线，扩展名为 png/jpg/jpeg/gif/webp。框架的上传输入仍仅支持 PNG/JPEG，示例也只返回 png/jpg。

**不能返回 JSON、HTML、完整 URL、磁盘路径或重定向页面。** 不支持嵌套图片子目录。

根地址 `https://images.example.com` 和正文 `/images/a.png` 会组合为 `https://images.example.com/images/a.png`。根地址 `https://images.example.com/bot` 会组合为 `https://images.example.com/bot/images/a.png`，路径前缀会保留；代理应剥离 `/bot` 再转发到示例服务。

### 2.3 错误响应

| 状态码 | 示例中的含义 |
| --- | --- |
| 400 | multipart 损坏、缺少 image 文件或格式不符合要求 |
| 401 | 缺少或错误的 Bearer Token |
| 413 | 请求超过 31 MiB、图片为空或超过 30 MiB |
| 415 | 非 PNG/JPEG，或 MIME 与内容不一致 |
| 500 | 存储、服务配置或内部操作失败 |

错误正文可为短纯文本，不能泄露 Token、磁盘路径或异常堆栈。框架对失败响应抛出包含 HTTP 状态码的错误，不向插件返回错误正文中的“图片地址”。默认外部上传超时为 10 秒。

## 3. 图片读取与自动清理

图片路径必须允许匿名 GET 和 HEAD；QQ 获取 Markdown 图片时不会附带图床 Bearer Token 或管理页面 Cookie。

读取成功返回准确的 `Content-Type`、`Content-Length`、原始图片字节，以及 `X-Content-Type-Options: nosniff`。HEAD 返回同样的头部但不返回图片正文。不存在、无效或过期的路径返回 404，其他方法返回 405。示例使用 `Cache-Control: no-store`；如自行改用 CDN/缓存，缓存有效期不能超过剩余保留时间，且需要考虑 CDN 是否会继续保留到期内容。

建议把图片实际内容放在 Web 静态目录之外，通过受控读取路由返回。不要让 Web 服务直接读取 storage，也不要执行上传文件。

### 3.1 过期时间固定在上传时

两个示例使用如下文件名：

```text
<13位过期毫秒时间戳>-<32位随机十六进制>.png
```

这样不需要额外的元数据数据库，重启后能恢复过期判断。随机部分通过 Node `crypto.randomBytes` 或 PHP `random_bytes` 生成，不使用原文件名。保留时间改变只影响后续上传。文件名会暴露到期时间，不包含用户、群 OpenID 或其他业务标识。

读取时先检查到期时间，**到期立即返回 404**，不需要等清理任务实际删文件。清理只处理符合该格式的普通文件，跳过符号链接、子目录和其他文件。

### 3.2 没有请求时也必须清理

- Node：创建服务时清理一次，并默认每 600 秒执行一次定时清理；关闭时停止定时器。
- PHP：请求会触发带文件锁和时间间隔的清理；同时提供 `cleanup.php --watch` 常驻清理程序，或用计划任务运行 `cleanup.php`。**生产部署必须启动清理进程或配置计划任务**，才能在没有访问的情况下回收磁盘空间。

PHP 清理通过 `flock` 防止多个进程同时扫描。图片请求与清理之间可能发生文件已被删除的竞争，读取应返回 404，不返回空的 200 响应。

临时图片不是永久资源。已保存 Markdown 中的 URL 不会自动续期，机器人重启或重新加载插件也不会延长有效期。长期使用的 Markdown 回复应使用长期托管地址，或者由插件保存原图并实现重新上传。

## 4. 独立 Node.js 示例

文件：[node/server.cjs](../examples/external-image-host/node/server.cjs)。要求 Node.js 22.13+，没有 npm 依赖，没有框架导入。使用 Node 自带 HTTP 服务和 [Request/FormData API](https://nodejs.org/api/globals.html#class-request) 解析 multipart。

### 4.1 启动

PowerShell，进入复制后的 node 目录：

```powershell
$env:IMAGE_UPLOAD_TOKEN = '请替换为随机生成且至少16字符的令牌'
$env:IMAGE_HOST = '127.0.0.1'
$env:IMAGE_PORT = '8081'
$env:IMAGE_TTL_SECONDS = '86400'
$env:CLEANUP_INTERVAL_SECONDS = '600'
node .\server.cjs
```

Linux/macOS：

```bash
export IMAGE_UPLOAD_TOKEN='请替换为随机生成且至少16字符的令牌'
export IMAGE_HOST=127.0.0.1
export IMAGE_PORT=8081
export IMAGE_TTL_SECONDS=86400
export CLEANUP_INTERVAL_SECONDS=600
node server.cjs
```

| 环境变量 | 默认 / 要求 |
| --- | --- |
| `IMAGE_UPLOAD_TOKEN` | 必填，至少 16 字符，必须与机器人上传 Token 一致 |
| `IMAGE_HOST` | `127.0.0.1` |
| `IMAGE_PORT` | `8081` |
| `IMAGE_STORAGE_DIR` | 程序目录下 `storage`，推荐提供绝对路径 |
| `IMAGE_TTL_SECONDS` | `86400`，大于 0，不超过 31536000 |
| `CLEANUP_INTERVAL_SECONDS` | `600`，大于 0，不超过 86400 |

运行账户需要创建、读取、写入、删除 storage 内文件的权限。服务管理器负责进程常驻和异常重启。定时清理失败会记录服务器日志，下个周期继续尝试。

### 4.2 配置机器人

如果公网域名 `https://images.example.com` 的反向代理指向本服务：

```dotenv
QQBOT_IMAGE_HOST_MODE=external
QQBOT_IMAGE_HOST_ORIGIN=https://images.example.com
QQBOT_IMAGE_UPLOAD_URL=https://images.example.com/upload
QQBOT_IMAGE_UPLOAD_TOKEN=与IMAGE_UPLOAD_TOKEN相同的令牌
```

`/upload` 是示例程序选择的路由，框架不依赖这个路径。代理也可以将公网 `/api/images` 映射到服务 `/upload`，此时机器人上传地址配置成 `https://images.example.com/api/images`。

## 5. 独立 PHP 示例

目录包含：

- [config.php](../examples/external-image-host/php/config.php)：配置、文件名校验、清理逻辑和文件锁。
- [public/index.php](../examples/external-image-host/php/public/index.php)：上传与图片读取路由。
- [cleanup.php](../examples/external-image-host/php/cleanup.php)：一次清理或常驻定时清理。

要求 64 位 PHP 8.1+，启用 Fileinfo、文件上传，CLI 和 Web 进程都具有 storage 读写权限。无需 Composer。Web 文档根目录必须是 `public`，config.php、cleanup.php、storage 不放进公开目录。保存使用 PHP 的 [`move_uploaded_file`](https://www.php.net/manual/en/function.move-uploaded-file.php)，不接受客户端传入的磁盘路径。

### 5.1 本地运行

PowerShell，进入复制后的 php 目录：

```powershell
$env:IMAGE_UPLOAD_TOKEN = '请替换为随机生成且至少16字符的令牌'
$env:IMAGE_TTL_SECONDS = '86400'
$env:CLEANUP_INTERVAL_SECONDS = '600'
# 建议显式填写绝对路径，Web 服务与清理进程必须指向同一目录。
$env:IMAGE_STORAGE_DIR = Join-Path (Get-Location) 'storage'
php -d upload_max_filesize=30M -d post_max_size=31M -S 127.0.0.1:8081 -t public public/index.php
```

在另一个终端设置相同 Token、存储目录、保留时间和清理间隔后运行：

```powershell
php .\cleanup.php --watch
```

`php -S` 用于本地验证。生产可使用 Nginx/Apache + PHP-FPM，并保证 `/upload` 和 `/images/*` 都进入 `public/index.php`，而不是直接映射图片文件。

### 5.2 Nginx + PHP-FPM 配置示意

以下路径、域名和 socket 需替换为实际值；TLS 配置按部署环境补充：

```nginx
server {
    listen 80;
    server_name images.example.com;
    root /srv/image-host/php/public;
    client_max_body_size 31m;

    location / {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /srv/image-host/php/public/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_param HTTP_AUTHORIZATION $http_authorization;
        fastcgi_pass unix:/run/php/php-fpm.sock;
    }
}
```

PHP-FPM 的 php.ini 应设置 `upload_max_filesize=30M`、`post_max_size=31M`、合理的 `max_file_uploads`、上传超时与内存上限。FPM 进程必须得到 `IMAGE_UPLOAD_TOKEN` 等环境变量；某些 FPM 配置会清空环境，需在服务配置或 pool 的 `env[...]` 中显式提供。CLI 清理进程也需要同样的存储配置。

### 5.3 定时清理方案

推荐通过服务管理器常驻运行：

```bash
php /srv/image-host/php/cleanup.php --watch
```

也可以用 cron 每 10 分钟执行一次，下列运行环境文件由运维创建、仅运行账户可读，用于提供 `IMAGE_UPLOAD_TOKEN`、`IMAGE_STORAGE_DIR` 等变量：

```cron
*/10 * * * * . /etc/image-host.env; /usr/bin/php /srv/image-host/php/cleanup.php
```

环境文件需使用 `export NAME=value` 形式，避免变量只停留在 shell 中。Windows 可用任务计划程序每 10 分钟运行 `php.exe`，参数为 cleanup.php 的绝对路径，并给任务运行账户配置相同环境。保留请求触发清理，可覆盖计划任务暂时停止的情况；它不能替代无流量时的定时任务。

### 5.4 配置机器人

与 Node 示例相同：图片根地址配置公网域名，上传地址配置公网 `/upload` 或代理映射的其他完整路径，令牌配置与 PHP 环境中的值一致。不要把文件系统的 storage 目录填入任何 URL 配置。

## 6. 手动验证

用一张真实 PNG 测试，不要用只包含图片签名的伪造文件：

```powershell
# PowerShell 使用 curl.exe，避免旧版本中的 curl 别名。
curl.exe -i -H "Authorization: Bearer $env:IMAGE_UPLOAD_TOKEN" -F "image=@example.png;type=image/png" http://127.0.0.1:8081/upload
```

成功应返回 201 和 `/images/...png`。复制路径，匿名 GET 应得到相同图片，HEAD 应得到正确类型和长度。上传缺少 Token 应返回 401；伪造 PNG 应返回 415；超过 30 MiB 应返回 413。临时将 `IMAGE_TTL_SECONDS` 设为 5、`CLEANUP_INTERVAL_SECONDS` 设为 1 后重启服务，上传新图片，5 秒后读取应返回 404，清理后磁盘文件消失。恢复生产保留时间只影响以后上传的图片。

框架仓库中的 `test/temporary-image-host.test.js` 覆盖 Node 后端与框架互通、内置 SQLite 保存、读取、重启、到期和清理。PHP 程序需在具有 PHP/Fileinfo 的运行环境完成 `php -l` 与同样的 HTTP 验证。

## 7. 部署检查与常见问题

| 现象 | 检查项 |
| --- | --- |
| 机器人提示外部图床未配置 | 必须同时填写图片根地址、完整上传地址和上传 Token，然后重启 |
| HTTP 401 | 两端 Token 是否一致，代理是否保留 Authorization，FPM 是否得到环境变量 |
| 返回地址校验失败 | 后端是否返回了纯文本 `/images/文件名.png`，是否混入 PHP 警告或 JSON |
| 上传成功但 QQ 无法显示 | 图片 URL 是否能被公网匿名访问，代理是否正确转发路径，是否使用了额外登录认证 |
| PHP 上传失败 | Fileinfo 是否启用，上传临时目录是否可写，post_max_size/upload_max_filesize 是否正确 |
| 到期后磁盘文件还在 | 是否运行 Node 进程或 PHP 清理任务，清理进程的存储目录和权限是否一致 |
| 改了保留时间旧图仍按旧时间过期 | 属于预期行为，旧图过期时间已固定，需要重新上传 |
| 切换外部/内置后旧 URL 不可用 | 不自动迁移图片；保留旧服务或重新上传，并更新保存的 Markdown |

生产上传接口使用 HTTPS，令牌只保存在服务配置和机器人环境变量中。根据实际流量配置代理限流、磁盘容量监控和上传并发限制。storage 只存图床自身文件，运行账户不应拥有修改业务代码的权限。若加入 CDN、对象存储或多实例部署，应由后端统一保证图片可读与过期删除，框架上传协议保持一致。
