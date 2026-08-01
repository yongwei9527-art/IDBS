# VPS 部署、更新与 App 配对

本文说明当前仓库中 `scripts/install.sh`、`scripts/update.sh`、`scripts/backup.sh` 的使用方式，以及 Android App 与服务器的安全配对流程。脚本面向 Ubuntu/Debian VPS，要求以 `root` 或具有 `sudo` 权限的账号执行。

> 生产环境建议先配置可解析到 VPS 的 HTTPS 域名。没有域名时可以安装并以公网 IP 访问网页；但当前 Android 安全配对只接受 `https://` 服务器地址，无 HTTPS 时请先配置域名证书，或在 App 中使用已有的手动服务器地址配置作为临时后备方案。

## 1. 一键安装

从 GitHub 主分支执行安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh | sudo bash
```

也可以先克隆仓库后执行：

```bash
git clone https://github.com/yongwei9527-art/IDBS.git
cd IDBS
sudo bash scripts/install.sh
```

安装器会安装或准备 Node.js、Nginx、PostgreSQL、应用依赖和服务，并拉取指定分支的源码。它会交互询问：

1. **访问域名**：可留空，留空时自动检测服务器公网 IP；输入域名时可选择自动申请 Let's Encrypt HTTPS 证书。
2. **最高管理员账号**：默认 `13900000000`，可改为管理员手机号/登录账号。
3. **最高管理员密码**：可自行输入 12–128 位密码；留空时生成强随机密码，并仅在安装完成的终端输出中显示。首次登录后应立即修改。
4. **数据目录**：导出、上传、备份和数据库运维目录均可自定义，必须是绝对路径。

默认目录如下（可在安装向导中覆盖）：

| 项目 | 默认目录 | 环境变量 |
| --- | --- | --- |
| 应用运行目录 | `/var/www/laboratory-management-system/current` | `APP_BASE` 派生 |
| 源码目录 | `/var/www/laboratory-management-system-src` | `SRC_DIR` |
| 导出文件 | `/var/www/laboratory-management-system/exports` | `EXPORT_DIR` |
| 上传文件 | `/var/www/laboratory-management-system/uploads` | `UPLOAD_DIR` |
| 备份文件 | `/var/www/laboratory-management-system/backups` | `BACKUP_DIR` |
| 数据库运维目录 | `/var/www/laboratory-management-system/database` | `DATABASE_DIR` |

`DATABASE_DIR` 由安装器创建并保留给数据库运维数据；现有部署仍由系统 PostgreSQL 服务管理实际数据库集群目录，不会在安装时做破坏性数据库目录迁移。

安装结束会显示类似信息：

```text
安装完成！
系统地址：https://lab.example.com/v5/
后台地址：https://lab.example.com/v5/admin
App 下载页：https://lab.example.com/download
最高管理员账号：13900000000
最高管理员密码：仅首次安装终端显示的随机密码（或您输入的密码）
```

若 HTTPS 证书申请失败，安装不会删除已创建的数据；服务会继续使用 HTTP，并应在 DNS 生效后重新配置证书。再次运行安装器检测到已有安装时，会保留现有最高管理员账号和密码。

## 2. 安装后的配置与检查

安装器将公开地址、跨域来源、目录和 App 配对配置写入共享 `.env`，其中包括：

```env
APP_PUBLIC_URL=https://lab.example.com
CORS_ORIGIN=https://localhost,https://lab.example.com
UPLOAD_DIR=/var/www/laboratory-management-system/uploads
EXPORT_DIR=/var/www/laboratory-management-system/exports
BACKUP_DIR=/var/www/laboratory-management-system/backups
DATABASE_DIR=/var/www/laboratory-management-system/database
APP_PAIRING_TTL_MINUTES=10
```

安装器还会生成 `APP_PAIRING_SECRET`。该值仅保存在服务器 `.env`，不得复制到客户端、日志、截图或仓库。

检查服务状态：

```bash
sudo systemctl status laboratory_management_system --no-pager
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
sudo journalctl -u laboratory_management_system -f
```

## 3. 更新与备份

在默认源码目录中执行：

```bash
cd /var/www/laboratory-management-system-src
sudo bash scripts/update.sh
```

`update.sh` 仅允许在已安装环境中运行，并委托现有安全更新流程：拒绝覆盖有本地修改的源码、执行更新前备份、拉取并部署代码、重启服务以及检查 `/ready` 健康状态。请在升级前确认源码目录没有未提交的人工修改。

手动创建完整备份：

```bash
cd /var/www/laboratory-management-system-src
sudo bash scripts/backup.sh
```

`backup.sh` 使用文件锁避免并发执行，创建并校验 PostgreSQL 备份，同时归档上传目录与独立的导出目录。它会按 `BACKUP_RETENTION_DAYS`（默认 14 天）清理旧备份。仅校验最新数据库备份时使用：

```bash
sudo bash scripts/backup.sh --verify
```

备份文件含业务数据，应限制为管理员和备份系统可读；恢复数据库会覆盖现有数据，必须在维护窗口确认备份时间后再操作。

## 4. 下载页与 APK 发布

部署后的下载页地址为：

```text
https://<服务器>/download
```

下载页提供网页版入口、Android APK 下载入口和当前服务器的配对二维码。服务从活动应用目录下的以下路径提供 APK：

```text
public/download/app.apk
```

因此将已签名的 Release APK 放到活动部署的 `public/download/app.apk` 后，即可通过：

```text
https://<服务器>/download/app.apk
```

下载。发布新版本时应随部署一同更新该文件；不要把 Android 签名私钥、`key.properties` 或任何生产密钥上传到 GitHub Release。

## 5. App 公开配置与二维码配对接口

以下接口不要求用户登录，但只返回公开服务器配置；服务器部署必须设置 `APP_PUBLIC_URL` 和 `APP_PAIRING_SECRET`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v5/app-config` | 返回 App 名称、服务器地址、Web/API/下载地址和 APK 地址。 |
| `GET` | `/api/v5/app-pairing` | 生成当前短期配对数据，包含二维码协议地址和过期时间。 |
| `GET` | `/api/v5/app-pairing/qr.svg` | 生成 SVG 二维码；响应使用 `Cache-Control: no-store`。 |
| `POST` | `/api/v5/app-pairing/exchange` | 验证扫码数据并返回规范化的公开 App 配置。 |

`GET /api/v5/app-config` 响应示例：

```json
{
  "app_name": "Laboratory Management System",
  "server_url": "https://lab.example.com",
  "web_url": "https://lab.example.com/v5/",
  "api_base_url": "https://lab.example.com/api/v5",
  "download_url": "https://lab.example.com/download",
  "apk_download_url": "https://lab.example.com/download/app.apk",
  "pairing_scheme": "labapp://pair"
}
```

二维码承载的协议格式是：

```text
labapp://pair?v=1&server=https%3A%2F%2Flab.example.com&token=<短期令牌>
```

令牌由服务器使用仅存于 `.env` 的 `APP_PAIRING_SECRET` 签名。默认有效期为 10 分钟（`APP_PAIRING_TTL_MINUTES`，服务端限制为 1–60 分钟）。令牌不是登录凭据，也不会授予任何用户权限。

App 扫码后的正确流程：

1. Android 接收 `labapp://pair` 深度链接，验证其为 HTTPS 服务器地址；不接受账号密码、查询/片段或非标准 HTTPS 地址。
2. App 仅在内存中暂存二维码中的短期 `token`，然后向该服务器提交：

   ```http
   POST /api/v5/app-pairing/exchange
   Content-Type: application/json

   {"v":"1","server":"https://lab.example.com","token":"<短期令牌>"}
   ```

3. 服务器验证服务器地址、有效期和签名，成功后返回公开配置。
4. App 保存服务器返回的规范 HTTPS 地址，并清除内存中的令牌；Android 端使用 Android Keystore 派生的加密存储保存服务器地址。
5. 用户进入正常登录页，使用**自己的**账号和密码登录。

二维码过期、属于其他服务器或验证失败时，刷新 `/download` 页面生成新码后重新扫码。配对只配置服务器地址，**不创建登录会话、不自动登录、不能重置管理员密码**。

## 6. 必须遵守的安全边界

以下敏感信息禁止放入 App、二维码、下载页、前端代码、GitHub 仓库、GitHub Release、问题讨论、截图或普通日志：

- 最高管理员账号密码；
- PostgreSQL/数据库密码；
- JWT/`TOKEN_SECRET`；
- `APP_PAIRING_SECRET`；
- Android 发布签名私钥或密钥库口令。

最高管理员密码可以由安装者输入，也可以由安装器随机生成；随机密码仅应在安装终端中记录一次，并在首次登录后立即修改。二维码中的 `token` 只能用于短期服务器地址兑换，不能替代用户身份认证。

## 安全配对二维码的 HTTPS 限制

App 的二维码配对只用于导入已验证的服务器地址；它不是登录凭据，也不包含管理员密码、数据库密码、JWT 密钥或配对密钥。为避免在明文连接或非标准入口上错误配对，下载页只有同时满足以下条件时才会提供配对二维码：

- `APP_PUBLIC_URL` 是标准 HTTPS 公网地址，格式为 `https://example.com`；
- 该地址使用 HTTPS 默认端口 **443**（不要附带 `:8443` 等非 443 端口）；
- 服务端已配置非空的 `APP_PAIRING_SECRET`，并且该值仅保存在服务器 `.env` 中。

域名留空、使用 IP/HTTP、HTTPS 证书申请失败，或 HTTPS 使用非 443 端口时，系统的网页版和 App 的**手动服务器地址**配置仍可使用；但下载页不会提供配对二维码，App 也不应使用扫码配对。用户可在 App 登录页手动输入当前服务器地址后，再使用自己的账号和密码登录。

### 将现有 HTTP/IP 安装改为可扫码的 HTTPS 安装

1. 为 VPS 准备可解析到该服务器的域名，并在 DNS 中完成解析。
2. 在 Nginx/安装流程中为该域名申请并启用有效的 HTTPS 证书；公网入口使用 443 端口。
3. 将服务器 `.env` 的 `APP_PUBLIC_URL` 设置为该域名的标准 HTTPS 原点，例如 `https://lab.example.com`，不要包含路径、查询参数、片段或非 443 端口。
4. 在服务器 `.env` 中配置高强度随机 `APP_PAIRING_SECRET`；仅由服务器读取，禁止写入 App、二维码、GitHub、Release、日志或截图。
5. 重启应用和反向代理后，重新打开 `/download`。满足条件时页面会显示新的短期配对二维码；旧二维码过期后请刷新页面重新获取。

扫码成功仅会交换并保存规范化服务器地址，随后仍必须由用户输入自己的普通账号和密码完成登录。若 HTTPS 尚未就绪，请继续使用手动地址配置，不要为方便扫码而降低 App 或服务端的传输安全策略。