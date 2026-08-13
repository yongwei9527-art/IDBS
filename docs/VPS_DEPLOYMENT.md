# VPS 部署、更新与 App 配对

本文说明当前仓库中 `scripts/install.sh`、`scripts/update.sh`、`scripts/backup.sh` 的使用方式，以及 Android App 与服务器的安全配对流程。全新安装支持 Ubuntu 22.04/24.04、Debian 12/13，要求 systemd 作为 PID 1，并以 `root` 或具有 `sudo` 权限的账号执行。旧系统上的已有安装只允许进入恢复兼容模式。

> 生产环境建议先配置可解析到 VPS 的 HTTPS 域名。没有域名时仍可安装，并通过 `http://公网IP/v5/` 访问网页、在 App 中手动填写服务器地址；安全二维码配对则要求可公开解析的 HTTPS 域名和标准 443 端口。

## 1. 一键安装

从 GitHub 主分支执行安装器：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh'
  sudo bash "$tmp"
)
```

也可以先克隆仓库后执行：

```bash
git clone https://github.com/yongwei9527-art/IDBS.git
cd IDBS
sudo bash scripts/install.sh
```

安装器会准备系统级 Node.js 22、Nginx、固定的 PostgreSQL 16、应用依赖和服务，并拉取指定分支的源码。全新安装不会使用发行版碰巧提供的 PostgreSQL 主版本。它会交互询问：

项目的唯一正式安装入口是 `scripts/install.sh`；`scripts/install-vps.sh` 只是向后兼容包装器。Linux 服务统一命名为 `laboratory-management-system`，旧服务名 `laboratory_management_system` 会作为兼容别名保留。PostgreSQL 数据库 `laboratory_management_system` 和用户 `laboratory_management_system_user` 仍使用下划线。

1. **访问域名**：可留空，留空时自动检测服务器公网 IP；输入域名时可选择自动申请 Let's Encrypt HTTPS 证书。
2. **最高管理员账号**：默认 `13900000000`，可改为管理员手机号/登录账号。
3. **最高管理员密码**：可自行输入 12–128 位密码；留空时为本次安装生成独立的强随机临时密码。安装成功后会在终端显示，并写入 root-only 的安装信息；首次登录强制修改。
4. **数据目录**：导出、上传、备份和数据库运维目录均可自定义，必须是专用的绝对路径。四个目录不得相同或互相嵌套，也不得指向系统根目录、`current`/`previous`、`releases`、自托管 APK、源码或共享密钥目录；路径仅允许常规 Linux 文件名字符，不接受空格、换行或 shell 元字符。
5. **Firebase 推送（可选）**：可输入 VPS 上 Firebase Admin SDK 服务账号 JSON 的绝对路径。安装器验证文件后仅把压缩 JSON 的 Base64 写入权限为 `600` 的共享 `.env`，不会输出私钥内容。

账号、姓名和密码提示均可直接按 Enter。默认账号为 `13900000000`，默认姓名为 `System Administrator`；密码留空时，安装器会为本次安装生成独立的随机强临时密码，而不是使用所有服务器相同的固定密码。该密码会在安装成功后输出并写入 root-only 的安装信息，首次登录后强制修改。

域名留空不会阻止安装。安装器会优先检测公网 IPv4，无法访问外部检测服务时再选择本机有效 IPv4；无域名模式跳过 Certbot，使用 `http://公网IPv4` 和 Nginx 80 端口。也可在域名提示处直接输入公网 IPv4。若自动探测只能得到私网/局域网 IPv4，交互安装必须明确确认才会继续为 LAN-only 部署，非交互安装默认拒绝；用户显式输入私网 IPv4 时仍会收到不可供互联网客户端使用的警告。若完全无法取得有效 IPv4，则会停止并要求重新输入公网 IPv4 或域名。

云厂商安全组或外部防火墙必须允许 TCP 80 入站；使用 HTTPS 域名时还要允许 TCP 443。安装器不会自动放宽服务器已有的防火墙策略。安装前会检查 systemd、并发部署、应用端口以及 80/443 冲突；安装结束会先检查 `127.0.0.1:PORT/ready`，再通过本机 Nginx 按实际域名/IP 检查公共 `/ready` 路由。内部 `127.0.0.1` 检查不是最终用户访问地址。若 UFW 已启用，可根据实际入口执行 `sudo ufw allow 80/tcp`，域名 HTTPS 环境再执行 `sudo ufw allow 443/tcp`。

默认目录如下（可在安装向导中覆盖）：

| 项目 | 默认目录 | 环境变量 |
| --- | --- | --- |
| 当前版本软链接 | `/var/www/laboratory-management-system/current` | `APP_BASE` 派生 |
| 独立版本目录 | `/var/www/laboratory-management-system/releases/<id>` | `APP_BASE` 派生 |
| 前一版本软链接 | `/var/www/laboratory-management-system/previous` | `APP_BASE` 派生 |
| 源码目录 | `/var/www/laboratory-management-system-src` | `SRC_DIR` |
| 导出文件 | `/var/www/laboratory-management-system/exports` | `EXPORT_DIR` |
| 上传文件 | `/var/www/laboratory-management-system/uploads` | `UPLOAD_DIR` |
| 备份文件 | `/var/www/laboratory-management-system/backups` | `BACKUP_DIR` |
| 自托管 APK | `/var/www/laboratory-management-system/downloads/app.apk` | `APP_BASE` 派生 |
| 数据库运维目录 | `/var/www/laboratory-management-system/database` | `DATABASE_DIR` |

`DATABASE_DIR` 只是数据库备份、恢复或维护过程中使用的**运维目录**，不是 PostgreSQL 的 `PGDATA`。实际数据库集群目录仍由系统 PostgreSQL 服务和发行版管理（通常位于 `/var/lib/postgresql/...`）；安装器不会把它迁移到 `DATABASE_DIR`，也不会把该目录描述为实际数据库数据目录。

安装结束会显示类似信息：

```text
安装完成！
系统地址：https://lab.example.com/v5/
后台地址：https://lab.example.com/v5/admin
App 下载页：https://lab.example.com/download
最高管理员账号：13900000000
最高管理员临时密码：本次安装随机生成的密码（或您输入的密码）
```

安装后可运行 VPS 管理面板：

```bash
sudo db
```

菜单提供：1）查看 App/网页地址和最近记录的最高管理员临时凭据；2）重置最高管理员账号密码，可使用面板生成的随机强临时密码或输入 12–128 位自定义密码；3）退出。安装信息文件为 `/var/www/laboratory-management-system/shared/install-info`，权限为 `root:root 600`。用户修改密码后，面板中记录的旧临时密码可能已经失效；旧安装若没有可用的凭据记录，应使用菜单第 2 项重置。安装或面板重置后的账号均在下次登录时强制修改密码。

若 HTTPS 证书申请失败，安装不会删除已创建的数据；服务会继续使用 HTTP，并应在 DNS 生效后重新配置证书。再次运行安装器检测到已有安装时，会保留现有最高管理员账号和密码。

若安装在依赖下载、数据库初始化或服务启动阶段中断，直接重新运行同一条 `scripts/install.sh` 命令。安装器会重新执行部署流程，并尽量复用已完成的环境、保留数据库和上传文件；这不代表所有安装步骤都能事务性回滚。首次管理员初始化可通过 `/var/www/laboratory-management-system/shared/.initial-super-admin-pending`（`root:root 600`）恢复；成功后该临时文件会被删除并写入 root-only 的 `install-info`。不要为了重试而删除 `.env`。

## 2. 安装后的配置与检查

安装器将公开地址、跨域来源、目录和 App 配对配置写入共享 `.env`，其中包括：

```env
APP_PUBLIC_URL=https://lab.example.com
CORS_ORIGIN=https://localhost,https://lab.example.com
UPLOAD_DIR=/var/www/laboratory-management-system/uploads
EXPORT_DIR=/var/www/laboratory-management-system/exports
EXPORT_RETENTION_DAYS=30
BACKUP_DIR=/var/www/laboratory-management-system/backups
RELEASE_RETENTION_COUNT=5
DATABASE_DIR=/var/www/laboratory-management-system/database
APP_PAIRING_TTL_MINUTES=10
```

`EXPORT_RETENTION_DAYS` 控制独立导出目录中的任务文件保留时间，默认 `30` 天，允许范围为 `1`–`3650` 天。安装和更新会保留已有的合法值；旧部署缺少该变量时会补写默认值 `30`，不会覆盖管理员已设置的合法保留天数。

`RELEASE_RETENTION_COUNT` 控制服务器保留的代码版本总数，默认 `5`，允许范围为 `2`–`20`。`current` 与 `previous` 指向的版本始终受保护；清理程序只删除 `releases/` 中带部署标记的更旧版本，不处理上传、导出、备份、共享 `.env` 或数据库。

安装器还会生成 `APP_PAIRING_SECRET`。该值仅保存在服务器 `.env`，不得复制到客户端、日志、截图或仓库。

VPS 部署强制设置 `HOST=127.0.0.1`：Node 服务只接受本机反向代理连接，外部客户端必须通过 Nginx 的 80/443 端口访问，不能直接连接 Node 的 `:3000` 端口。

检查服务状态：

```bash
sudo systemctl status laboratory-management-system --no-pager
ENV_FILE=/var/www/laboratory-management-system/shared/.env
PORT="$(sudo sed -n 's/^PORT=//p' "$ENV_FILE" | tail -n 1)"
PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:${PORT}/health"
curl -fsS "http://127.0.0.1:${PORT}/ready"
sudo journalctl -u laboratory-management-system -f
```

### 2.1 配置或轮换 Firebase Android 推送

Firebase 推送需要两份用途不同的配置：

- Android 客户端 `google-services.json`：仅用于构建 APK，应以 Base64 保存到 GitHub Actions Secret `ANDROID_GOOGLE_SERVICES_JSON_BASE64`，不得提交仓库。
- Firebase Admin SDK 服务账号 JSON：仅供 VPS 服务端调用 FCM HTTP v1，应保存在部署密钥中，绝不能放进 APK、下载页、二维码或 GitHub Release。

首次安装时可直接在安装向导中选择配置。已经安装的服务器可先通过 SCP/SFTP 把服务账号 JSON 临时上传到 VPS，再执行：

```bash
sudo /usr/local/sbin/laboratory-management-system-configure-firebase /root/firebase-admin-service-account.json
```

该命令由部署程序安装为 `root:root` 所有且不可由应用用户修改，避免从应用可写目录执行提权脚本。它会验证 `type`、`project_id`、`client_email` 和私钥结构，通过受限临时文件更新 `FCM_SERVICE_ACCOUNT_JSON_BASE64`（不会把凭据放入进程命令行），清除旧的原始 JSON 环境变量，重启服务并最多等待 30 秒检查 `/ready`。失败时会恢复原配置并再次重启服务。

本地校验和 `/ready` 不能证明 Firebase IAM 权限或 VPS 到 Google 的网络一定可用；配置后请由管理员发送一次测试通知完成端到端验证。完成并做好加密离线备份后，应安全删除 VPS 上临时上传的源 JSON 文件。

不要在命令行参数中粘贴完整 JSON；只传文件路径。更新脚本会保留共享 `.env` 中的 Firebase 配置。

## 3. 更新与备份

在默认源码目录中执行：

```bash
sudo laboratory-management-system-update
```

`update.sh` 仅允许在已安装环境中运行：它拒绝覆盖有本地修改的源码、按照 `.env` 中的自定义目录执行更新前备份、拉取代码、在当前服务继续运行时构建独立候选版本、执行数据库迁移、切换代码软链接、重启服务并检查 `/ready`。应用代码切换是原子的，但数据库迁移不属于同一个事务性发布单元；请在升级前确认源码目录没有未提交的人工修改和备份可用。

### 3.1 应用代码原子切换与失败回退

VPS 代码目录采用以下结构：

```text
/var/www/laboratory-management-system/
├── releases/
│   ├── 20260810T120000Z-a1b2c3d4e5f6/
│   └── 20260811T083000Z-b2c3d4e5f6a1/
├── current  -> releases/20260811T083000Z-b2c3d4e5f6a1
├── previous -> releases/20260810T120000Z-a1b2c3d4e5f6
└── shared/.env
```

更新顺序如下：

1. 当前服务继续在线；新源码被复制到新的 `releases/<id>`，依赖安装、Web 构建和 doctor 前置检查均在候选目录完成，不覆盖 `current`。
2. 更新器创建 PostgreSQL 自定义格式备份，并用校验和及 `pg_restore --list` 验证。部署阶段复用并再次验证同一份备份，不重复创建另一份迁移前备份。
3. 只有候选构建及备份都成功后才停止服务，并从候选版本执行向前数据库迁移。
4. `previous` 先指向旧版本，再以同一文件系统内的原子重命名把 `current` 切到候选版本；systemd 始终通过 `current` 启动。
5. 新服务通过 `/ready` 后发布完成，并按 `RELEASE_RETENTION_COUNT` 清理旧代码目录。
6. 若重启或健康检查失败，脚本会立即把 `current` 切回旧代码并重新启动旧版本，同时保留失败候选用于诊断。

> **数据库不会自动回滚。** 应用代码回退与数据库恢复是两件不同的操作，整个更新流程不能视为数据库与代码一起事务性回滚。迁移可能已提交且旧代码未必兼容新结构；自动执行 `pg_restore` 会覆盖迁移后的新数据，因此脚本只报告已验证备份地址。数据库恢复必须由管理员在维护窗口中审查迁移影响后显式执行。

首次从旧的“实体 `current/` 目录”升级时，部署器会在停机切换阶段把旧目录移入 `releases/legacy-<时间>`，然后建立 `current`/`previous` 软链接；不会删除旧版本或持久数据。

手动创建完整备份：

```bash
cd /var/www/laboratory-management-system-src
sudo bash scripts/backup.sh
```

每日 systemd 定时器与手动命令共用同一个 `backup.sh`：它使用文件锁避免并发执行，创建并校验 PostgreSQL 备份，同时归档上传目录与独立的导出目录。它会按 `BACKUP_RETENTION_DAYS`（默认 14 天，允许 1–3650 天）清理本系统命名的旧数据库备份、清单以及 `uploads-*.tar.gz`、`exports-*.tar.gz`，不会按目录年龄删除管理员手工放入的其他文件；安装或升级会补齐并校验该配置。数据库连接密码通过环境传递，不放入 `pg_dump` 的进程参数。仅校验最新数据库备份时使用：

```bash
cd /var/www/laboratory-management-system-src
sudo bash scripts/backup.sh --verify
```

备份文件含业务数据，应限制为管理员和备份系统可读；恢复数据库会覆盖现有数据，必须在维护窗口确认备份时间后再操作。

### 3.2 PostgreSQL 13 升级到 PostgreSQL 16

本项目默认把 PostgreSQL 16 作为经过测试的生产升级目标。已经成功安装过当前版本后，可在维护窗口执行：

```bash
sudo laboratory-management-system-upgrade-postgresql
```

若应用安装尚未成功，服务器上还没有上述管理命令，可直接下载独立升级器：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/upgrade-postgresql.sh'
  sudo bash "$tmp"
)
```

脚本只接受本项目 `.env` 中指向 `127.0.0.1:5432/laboratory_management_system` 的本地数据库，不会操作外部托管数据库；若同一 PostgreSQL 集群还有其他业务数据库或非核心扩展，也会停止并要求人工审查。执行前必须输入 `UPGRADE-POSTGRESQL` 确认。随后脚本会：

1. 检查磁盘空间、目标版本、主集群和本项目数据库；
2. 在应用目录的备份位置创建 PostgreSQL 自定义格式数据库备份、全局角色备份和 SHA-256 清单，并用 `pg_restore --list` 验证；
3. 必要时使用 PostgreSQL 官方 PGDG APT 仓库安装 PostgreSQL 16；仓库签名密钥会校验官方完整指纹；
4. 停止应用，使用 Debian/Ubuntu 的 `pg_upgradecluster` 完成集群升级，再检查数据库版本和应用 `/ready`；
5. 失败时尝试把未修改的旧集群切回原端口并恢复应用；成功时保留已停止的 PostgreSQL 13 集群，不自动删除。

成功后先检查：

```bash
sudo pg_lsclusters
sudo systemctl status laboratory-management-system --no-pager
```

至少观察数日并确认业务、备份和 App 连接正常后，才按升级器最终输出的精确版本和集群名执行 `pg_dropcluster --stop ...` 删除旧集群。不要提前卸载 PostgreSQL 13 软件包或删除 `/var/lib/postgresql/13`。需要无交互执行时必须显式设置 `CONFIRM_POSTGRES_UPGRADE=UPGRADE-POSTGRESQL`；可用 `TARGET_POSTGRES_MAJOR=15` 到 `18` 覆盖目标，但非 16 版本应先自行完成兼容性测试。

数据库主版本升级和操作系统升级是两项不同工作。若服务器操作系统已停止安全支持，应先规划系统快照、异机恢复演练与受支持操作系统迁移，不要把数据库升级当成操作系统安全更新的替代品。

### 3.3 安全卸载

`sudo bash scripts/uninstall-vps.sh` 会停止新旧服务名、移除 systemd/Nginx 配置和管理命令，但默认保留应用目录、上传、导出与备份数据。确实需要连同应用目录删除时，必须在完成离线备份后显式执行：

```bash
sudo env REMOVE_APP_DATA=1 \
  UNINSTALL_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM \
  bash scripts/uninstall-vps.sh
```

删除前脚本会再次校验绝对路径、危险系统目录和符号链接；PostgreSQL 数据库与用户始终不会被卸载脚本自动删除。

完整删除还要求 `$APP_BASE/shared/installation-owner` 存在，并且其中记录的 `APP_BASE`、`SRC_DIR`、服务名与当前参数一致；旧安装缺少标记时脚本会拒绝删除，应先重新运行当前安装器补齐标记。这些检查用于降低误删风险，但使用自定义目录时仍必须人工核对解析后的专用路径，确认字符串和所有权标记都不能替代离线备份。

远程执行正式卸载器时使用：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/uninstall-vps.sh'
  sudo bash "$tmp"
)
```

该远程命令使用默认服务名和默认目录。若安装时自定义了 `APP_BASE`、`SRC_DIR` 或服务名，应从服务器保留的同版本源码运行卸载器，并显式传入安装时相同的变量；不要让默认路径代替实际安装配置。

完整删除模式还会删除默认源码目录 `/var/www/laboratory-management-system-src`；应用目录外的自定义上传、导出、备份和数据库运维目录始终保留，现有 Let's Encrypt 证书也不会自动删除。

`scripts/prepare-vps.sh` 的彻底重装模式会同时删除受管应用目录和本机 `laboratory_management_system` 数据库，因此也采用双重确认。仅在完成离线备份后执行：

```bash
sudo env RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 \
  RESET_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM-DATA \
  bash scripts/prepare-vps.sh
```

不带上述两个变量运行 `scripts/prepare-vps.sh` 时是非破坏性准备：只安装基础依赖并确保受管根目录存在，不停止现有应用、不禁用 systemd 单元、不移除 Nginx 配置，也不删除数据库或文件。

## 4. 下载页与 APK 发布

部署后的下载页地址为：

```text
<APP_PUBLIC_URL>/download
```

例如域名 HTTPS 安装为 `https://lab.example.com/download`，无域名安装为 `http://服务器公网IP/download`。

下载页提供网页版入口和 Android APK 下载入口；只有服务器满足标准 443 HTTPS 域名等安全条件时才显示配对二维码。首次通过正式安装器部署时，`APK_DOWNLOAD_URL` 会自动配置为当前服务版本对应的 GitHub Release APK，因此 `/download` 不依赖仓库中携带二进制安装包。

如果 VPS 不能访问 GitHub，或希望由自己的服务器提供 APK，可将已签名的 Release APK 放到持久目录：

```text
/var/www/laboratory-management-system/downloads/app.apk
```

然后在 root-only 的 `.env` 中设置：

```env
APK_DOWNLOAD_URL=<APP_PUBLIC_URL>/download/app.apk
APK_DOWNLOAD_URL_MANAGED=self_hosted
```

每个候选版本的 `public/download` 都是指向该持久目录的软链接。重启服务后，`/download` 和 `GET /api/v5/app-config` 会返回该自托管地址，版本切换和旧版本清理不会删除 APK。首次从旧目录布局升级时，部署器会把现有的普通 `current/public/download/app.apk` 迁移到该目录；出于安全原因不会迁移符号链接。不要把 Android 签名私钥、`key.properties` 或任何生产密钥上传到 GitHub Release。

## 5. App 公开配置与二维码配对接口

以下接口不要求用户登录，但只返回公开服务器配置；服务器部署必须设置 `APP_PUBLIC_URL` 和 `APP_PAIRING_SECRET`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v5/app-config` | 返回 App 名称、服务器地址、Web/API/下载地址和 APK 地址。 |
| `GET` | `/api/v5/app-pairing` | 生成当前短期配对数据，包含二维码协议地址和过期时间。 |
| `GET` | `/api/v5/app-pairing/qr.svg` | 生成 SVG 二维码；响应使用 `Cache-Control: no-store`。 |
| `GET` | `/api/v5/app-pairing/link` | 校验 HTTPS App Link 后重定向到 App 的 `labapp://pair` 后备链接。 |
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
  "pairing_scheme": "labapp://pair",
  "pairing_app_link_path": "/api/v5/app-pairing/link",
  "instance_id": "laboratory-instance-01",
  "instance_fingerprint": "<64 位小写十六进制指纹>"
}
```

二维码优先承载同域 HTTPS App Link，并提供 `labapp://` 后备链接，协议版本为 v2：

```text
https://lab.example.com/api/v5/app-pairing/link?v=2&server=https%3A%2F%2Flab.example.com&token=<短期令牌>
labapp://pair?v=2&server=https%3A%2F%2Flab.example.com&token=<短期令牌>
```

令牌由服务器使用仅存于 `.env` 的 `APP_PAIRING_SECRET` 签名。默认有效期为 10 分钟（`APP_PAIRING_TTL_MINUTES`，服务端限制为 1–60 分钟）。令牌不是登录凭据，也不会授予任何用户权限。

App 扫码后的正确流程：

1. Android 通过同域 HTTPS App Link（或校验后的 `labapp://pair` 后备链接）接收配对数据，验证其中的 `server` 为无路径、无查询、无片段、标准 443 端口的 HTTPS 域名原点；链接不包含账号密码。
2. App 仅在内存中暂存二维码中的短期 `token`，并携带本机稳定但不含用户凭据的 `installation_id` 向该服务器提交：

   ```http
   POST /api/v5/app-pairing/exchange
   Content-Type: application/json

   {"v":"2","server":"https://lab.example.com","token":"<短期令牌>","installation_id":"<安装标识>"}
   ```

3. 服务器验证服务器地址、有效期、签名和单次使用状态；兑换成功后令牌不能再次使用，并返回服务器公开配置、实例 ID 和实例指纹。
4. App 先显示服务器身份供用户确认；只有用户确认后，才将规范 HTTPS 地址和实例身份作为一个受信配置写入 Android Keystore 派生的加密存储。安全身份发生变化时必须按服务器切换流程再次确认。
5. App 清除内存中的令牌，用户进入正常登录页并使用**自己的**账号和密码登录。

二维码过期、已兑换、属于其他服务器或验证失败时，刷新 `/download` 页面生成新码后重新扫码。配对只建立受信服务器配置，**不创建登录会话、不自动登录、不能重置管理员密码**。

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

扫码成功仅会交换并在用户确认后保存规范化服务器地址与实例身份，随后仍必须由用户输入自己的普通账号和密码完成登录。若 HTTPS 尚未就绪，请继续使用手动地址配置，不要为方便扫码而降低 App 或服务端的传输安全策略。
