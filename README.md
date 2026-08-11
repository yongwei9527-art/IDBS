# 实验室管理系统

## 旧文档导入

最高管理员可在网页后台的“导出中心”使用“旧文档导入”。支持 JSON、UTF-8 CSV，以及本系统导出的 HTML 格式 `.xls` 文件；可迁移用户账号与个人信息、设备、预约、使用/归还、故障和用户活动记录。

建议流程：下载 JSON 模板 → 上传文档 → 查看预检结果 → 输入 `IMPORT` → 执行导入。默认跳过现有数据；可选择更新普通用户/设备、自动补建缺失设备或跳过错误行。系统按规范化文档 SHA-256 防止仅修改空格、换行或字段顺序后的重复导入。

安全规则：只有最高管理员可执行；新账号的明文旧密码只在内存中读取并使用当前 scrypt 参数加密，上传文件中的旧密码哈希一律不受信任，现有账号的密码也绝不由导入覆盖；缺少密码时为新账号生成仅显示一次、7 天有效的临时密码并强制首次登录修改；导入文件中的管理员角色不会自动授予；当前管理员账号和软删除唯一键不会被旧文档覆盖。单个文件最多 10 MB、10,000 行，其中用户最多 200 行。

部署新版本后先执行数据库迁移：

```bash
npm run db:migrate
# 或现有 VPS 更新流程中的：npm run db:upgrade-schema
```

旧文档导入用于遗留数据迁移，不替代 PostgreSQL `pg_dump` 和上传文件备份；项目原地升级仍应优先使用完整数据库备份。

## 无邮件服务时找回密码

登录页提供“忘记密码？请求管理员重置”。用户填写登录手机号、姓名、学号、专业和导师信息后提交；接口不会公开账号是否存在，并采用账号、来源 IP、IP+账号三层限流。申请 7 天后过期。最高管理员在“用户管理”核对申请资料，通过后系统生成仅显示一次、24 小时有效的随机临时密码，并撤销该账号已有登录会话。用户使用临时密码登录后必须立即修改密码。密保问题不作为独立重置凭据，最高管理员账号仍只能通过 VPS `db` 面板恢复。

> **应用版本：实验室管理系统 5.0.8。当前 GitHub 发布标签：v5.0.8。** The canonical API and realtime contract is [docs/v5-api-contract.md](./docs/v5-api-contract.md). `/v5/` and `/api/v5` are stable compatibility paths, not the product version.

实验室管理系统 是一套面向 Ubuntu VPS 的设备预约、借还、图片归还、微信绑定和后台管理系统。后端使用 Node.js + Express，数据库使用 PostgreSQL，前端静态页面位于 `public/`。

使用或部署前，请先阅读 [免责声明](./DISCLAIMER.md)。


## v5.0.8 最新版本

v5.0.8 完成 VPS 安装、原子应用版本切换、安全备份与卸载校验，并补齐 Android App 的可信服务器身份持久化、一次性安全配对、旧文档导入和管理员密码恢复流程。

- [v5.0.8 发布说明](./docs/RELEASE-v5.0.8.md)
- [VPS 安装、管理与升级说明](./docs/VPS_DEPLOYMENT.md)
- [GitHub v5.0.8 安装包下载](https://github.com/yongwei9527-art/IDBS/releases/tag/v5.0.8)

新装用户使用正式签名 APK；已安装 v5.0.5 正式签名版的用户可直接覆盖升级。v5.0.4 Debug 包与正式签名不同，需要先按 v5.0.5 发布说明完成签名迁移或卸载后安装。
## Android FCM background and lock-screen notifications

Android Firebase Cloud Messaging (FCM) is integrated for generic new-message alerts while the Android app is in the background or on the lock screen.

- **Explicit opt-in:** In the Android app's Notification Center, enable Android notifications first, then select **Register remote alerts**. A device registration is bound to the signed-in user and is revoked on logout when possible.
- **Privacy:** Lock-screen and banner notifications only show **New message alert** and **You received a new message**. They never include chat text, names, phone numbers, passwords, JWTs, device tokens, or cookies.
- **Permissions:** Android declares only network access/state, Android 13+ notifications, and photo-picker compatibility permissions. Image selection uses the system picker whenever possible.
- **Fallback:** If FCM is not configured or is temporarily unavailable, in-app notifications and foreground WebSocket/local notifications continue to work. Sending chat messages is not blocked.
- **Android limitation:** After a user force-stops the app in Android settings, FCM cannot be delivered until the user opens the app again.

### Secure FCM deployment

1. Create a Firebase Android app using package ID com.laboratory.managementsystem.
2. Keep Firebase's `google-services.json` only in `web/android/app/google-services.json` on local machines. It is ignored by Git and must never be committed.
3. For GitHub Actions, Base64-encode that file and save it as the optional repository Actions secret `GOOGLE_SERVICES_JSON_BASE64`. The legacy name `ANDROID_GOOGLE_SERVICES_JSON_BASE64` remains accepted during migration, but do not configure conflicting values.
4. Store the complete server service-account JSON as Base64 in the VPS variable `FCM_SERVICE_ACCOUNT_JSON_BASE64`. Run `sudo /usr/local/sbin/laboratory-management-system-configure-firebase /absolute/path/service-account.json`, or provide that variable only to the command. The credential is validated before the root-owned `.env` is replaced, and its value is never printed.
5. Redeploy the server and install the new APK. Device registration tokens are encrypted at rest, deduplicated with an HMAC, and disabled when FCM reports them invalid.

Without Android Firebase configuration or server `FCM_SERVICE_ACCOUNT_JSON_BASE64`, the main app, login, pairing, chat and in-app/foreground notifications still build and run; only Android FCM background/lock-screen push is disabled. Sending messages is never blocked by missing FCM configuration.

## v5.0.4 Android 消息提醒体验与测试

本版完善 Android 安装包中的消息提醒体验，并补充实时事件隔离测试：

- **由用户主动开启**：首次使用不会自动弹出系统通知授权；请在应用的“通知中心”选择“开启消息提醒”。已拒绝时页面会说明需要前往系统设置开启并支持重新检查状态；
- **最小权限与隐私**：仅申请网络访问和 Android 13 及以上的通知权限。通知不包含聊天正文、发送者姓名、密码、Token 或 Cookie；锁屏显示采用私密级别；
- **在线范围**：App 在线且 WebSocket 实时连接正常时，收到其他成员的新聊天消息会显示通用系统提醒；发送者本人不会收到重复提醒。后台、锁屏或应用被关闭后的可靠推送仍需 Firebase Cloud Messaging（FCM）及服务端设备令牌管理；
- **事件测试**：新增 is_sender 服务层测试，确保通知通道只向发送者标注自身消息，聊天/SSE 的共享消息载荷不泄露该字段。

Android **debug 签名内部测试包**会随 [GitHub Releases](https://github.com/yongwei9527-art/IDBS/releases) 的 v5.0.4 发布。该包适合测试安装，不应视为已配置正式 release signing key 的生产包。

## 正式 Android release 签名与自动发布

仓库现在提供无秘密的正式签名基础设施：release 构建必须使用外置签名材料，缺少任一签名字段会直接失败，绝不会回退为 debug 签名。

- 本机：将 web/android/keystore.properties.example 复制为已忽略的 web/android/keystore.properties，并仅在本机填写签名材料；keystore 文件也必须保存在仓库外。
- CI：推送新的 `v*` 标签时，`.github/workflows/android-release.yml` 会从 GitHub Secrets 临时恢复 keystore，构建并校验签名 APK/AAB、生成校验和，随后由独立发布任务创建 GitHub Release。
- **必需的签名 Secrets**：`ANDROID_RELEASE_KEYSTORE_BASE64`、`ANDROID_RELEASE_STORE_PASSWORD`、`ANDROID_RELEASE_KEY_ALIAS`、`ANDROID_RELEASE_KEY_PASSWORD`。缺少任何一项、keystore 损坏或证书指纹不匹配都会立即失败；工作流不会生成替代密钥、不会回退到 debug 签名，也不会发布 APK。
- **可选的 Firebase Secrets**：`GOOGLE_SERVICES_JSON_BASE64` 用于 Android FCM；`FCM_SERVICE_ACCOUNT_JSON_BASE64` 仅在内存中校验服务端凭据并检查 Firebase 项目是否一致，不会写入 APK、Artifact 或 Release。旧名称 `ANDROID_GOOGLE_SERVICES_JSON_BASE64` 仅用于平滑迁移。
- 所有 Secrets 只在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中设置。工作流不会打印内容，并会在构建结束后删除临时 `google-services.json` 和 keystore。
- 只有正式签名材料完整且构建、签名、应用 ID、版本号、证书指纹与校验和全部通过后，新的 tag 才会产出正式安装包。

后台、锁屏或应用关闭后的可靠消息推送需要同一 Firebase 项目的 Android 配置与服务端凭据；它们始终由部署者通过 Secrets 提供，仓库不包含任何真实 Firebase 凭据或配置文件。

## v5.0.2 用户运营与移动端适配

本版完成最高管理员的用户运营视图与移动端可读性优化：

- **用户运营概览**：最高管理员可查看注册人数、待审核、正常用户、近 14 天注册趋势和设备使用状态汇总；
- **最近注册用户**：以个人信息卡展示姓名、状态、专业、导师、学号和注册时间，并可进入现有用户档案抽屉；
- **移动端资料卡**：用户管理及系统信息维护在手机和平板竖屏改为清晰的资料卡列表，避免横向挤压表格；
- **权限边界**：`/admin/system/operations-overview` 仅允许 `super_admin` 查询，普通管理员不会发起该请求。

## 一键安装

在 Ubuntu 22.04/24.04 VPS 终端执行：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh'
  sudo bash "$tmp"
)
```

安装脚本会先把 VPS 调整到适合安装 实验室管理系统 的状态，然后自动完成 Node.js、Nginx、PostgreSQL、数据库初始化、systemd 服务、反向代理、每日数据库备份和默认运行配置。

项目只有一个正式安装入口：`scripts/install.sh`。旧的 `scripts/install-vps.sh` 仅作为兼容入口并自动转到正式安装器。systemd 正式服务名统一为 `laboratory-management-system`；旧名称 `laboratory_management_system` 会保留为兼容别名，数据库名和数据库用户仍使用下划线，不要混淆。

仅在**全新、尚未部署本系统**的 VPS 上，才可先单独整理环境再安装：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh'
  sudo bash "$tmp"
)
```

准备脚本不是日常安装或更新入口。默认模式只安装基础依赖并确保受管目录存在，不停止现有应用、不移除 Nginx/systemd 配置，也不删除数据库或文件；新 VPS 完成准备后仍须执行上方唯一正式安装命令。只有确认要彻底重装时，才使用下面这个危险命令：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh'
  sudo env RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 \
    RESET_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM-DATA bash "$tmp"
)
```

两个环境变量必须同时、完整设置，防止误触发数据库和应用目录清理。执行前务必先完成离线备份。

全新安装会提供默认最高管理员账号并生成随机强临时密码，也可在向导中自行输入账号、姓名和 12–128 位密码。账号、姓名或密码提示处直接按 Enter 即采用默认值：账号为 `13900000000`，姓名为 `System Administrator`，密码为本次安装单独生成的随机强临时密码（不是所有服务器共用的固定密码）。安装完成后会明确输出：

```text
App 服务器连接地址：https://lab.example.com
网页访问地址：https://lab.example.com/v5/
最高管理员账号：13900000000
最高管理员临时密码：Lms!随机强密码
```

初始或通过 VPS 面板重置后的密码都是临时密码，账号首次登录后必须立即修改。安装信息保存在 `/var/www/laboratory-management-system/shared/install-info`，权限为 `root:root 600`；明文临时凭据仍有泄露风险，请限制 root 权限并避免复制到聊天、工单或日志。

如果安装中途失败，可直接重新执行同一条一键安装命令。安装器会重新执行部署流程，并尽量复用已完成的环境、保留数据库、上传文件以及 root-only 的待完成管理员凭据；这不等于所有步骤都能事务性回滚。不要删除 `shared/.env` 或 `.initial-super-admin-pending`。失败信息会同时给出 systemd、journalctl 和 Nginx 诊断命令。

安装脚本会询问“服务器是否有域名”，请按实际情况选择：

| 方式 | 浏览器访问 | APK 登录页填写 | 说明 |
| --- | --- | --- | --- |
| 有域名（推荐） | `https://你的域名/v5/` | `你的域名` 或 `https://你的域名` | 生产推荐，HTTPS 加密传输。 |
| 无域名 | `http://服务器公网IP/v5/` | `服务器公网IP` | 可先用 HTTP + 公网 IP 跑通；公网 IP 通常无法申请浏览器信任的免费 HTTPS 证书。 |
| 局域网部署 | `http://服务器局域网IP/v5/` | `服务器局域网IP` | 仅限能访问该局域网地址的设备，不是公网入口。 |

**没有域名也可以安装。** 安装器会优先自动检测 VPS 公网 IPv4，跳过 Certbot，并让 Nginx 通过 HTTP 80 端口提供服务；也可以在域名提示处直接输入公网 IPv4。若自动探测只能得到私网/局域网 IPv4，交互安装必须明确确认才会继续为 LAN-only 部署，非交互安装默认拒绝；若完全无法取得有效 IPv4，安装器会停止并要求重新输入公网 IPv4 或域名。用户显式输入私网 IPv4 时仍会显示该地址不可供互联网客户端使用的警告。

VPS 云厂商安全组/防火墙仍需允许入站 TCP 80；使用 HTTPS 域名时还需允许 TCP 443。安装器不会擅自修改已有防火墙策略。若本机启用了 UFW，可按实际需要执行 `sudo ufw allow 80/tcp` 和 `sudo ufw allow 443/tcp`。

VPS 部署中的 Node 服务只监听 `127.0.0.1`，公网或局域网客户端必须通过 Nginx 的 80/443 端口访问，不能直接连接 `:3000`。APK 内不写死服务器地址；登录页会自动识别：域名默认补 `https://`，IP/localhost 默认补 `http://`；后端安装脚本会把 APK WebView 来源 `https://localhost` 加入 `CORS_ORIGIN`。

安全二维码配对只对“可公开解析的域名 + 有效 HTTPS 证书 + 标准 443 端口”开放。无域名的 HTTP/IP、私网地址、证书申请失败或非 443 HTTPS 仍可使用网页和 App 手动服务器地址配置，但不会提供安全配对二维码。

安装后运行以下命令打开 VPS 小面板：

```bash
sudo db
```

菜单支持：1）查看 App/网页地址和最近生成的最高管理员临时凭据；2）重置最高管理员账号密码（使用默认随机强密码或自行输入）；3）退出。重置后同样强制首次登录改密。

如果访问 IP 时看到 `Welcome to nginx!`，说明 Nginx 默认站点抢占了请求。重新执行一键安装命令即可自动修复默认站点：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh'
  sudo bash "$tmp"
)
```

## 后台必做

登录后台后进入“系统配置”：

- 修改管理员密码，保存后立即生效。
- 按需填写公众号 `Token`、`AppID`、`AppSecret`、管理员 `OpenID`，保存后立即生效。
- 设置登录注意事项弹窗，用户登录后会自动弹出，用户需自行关闭。
- 设置其他用户是否能看到预约人的姓名、联系方式、学号。
- 设置结束使用设备时是否必须上传图片。
- 设置每日运营日报推送时间。

默认情况下不需要手动编辑 `/var/www/laboratory-management-system/shared/.env`。如果你误打开 `.env` 看到空白或提示 `No such file or directory`，直接重新执行上面的一键安装命令即可。

## 运维命令

查看服务状态：

```bash
sudo systemctl status laboratory-management-system
```

查看实时日志：

```bash
sudo journalctl -u laboratory-management-system -f
```

重启服务：

```bash
sudo systemctl restart laboratory-management-system
```

查看或重置最高管理员临时凭据：

```bash
sudo db
```

请使用菜单第 2 项重置最高管理员账号密码。面板可生成随机强临时密码，也可输入 12–128 位自定义密码；重置后的账号必须在下次登录时修改密码。

检查接口：

```bash
ENV_FILE=/var/www/laboratory-management-system/shared/.env
PORT="$(sudo sed -n 's/^PORT=//p' "$ENV_FILE" | tail -n 1)"
PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:${PORT}/health"
curl -fsS "http://127.0.0.1:${PORT}/ready"
```

升级到 GitHub 最新版本（会先备份数据库、上传文件和导出文件）：

```bash
sudo laboratory-management-system-update
```

更新器会在独立候选目录中构建，并对应用代码使用软链接切换；健康检查失败时会尝试切回旧应用代码。数据库迁移是向前执行且不会自动回滚，因此整个更新不能理解为数据库与代码一起事务性恢复；更新前应确认备份有效，并为数据库恢复预留维护窗口。

如需升级到指定发布标签：

```bash
sudo env RELEASE_REF=v5.0.8 laboratory-management-system-update
```

安全卸载（默认保留业务数据）：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/uninstall-vps.sh'
  sudo bash "$tmp"
)
```

默认卸载只会停止并移除 systemd 服务、Nginx 配置和管理命令，**保留**应用目录、源码、上传、导出、备份和数据库，便于恢复。需要在完成离线备份后连同默认应用目录和源码一起删除时，执行：

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" 'https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/uninstall-vps.sh'
  sudo env REMOVE_APP_DATA=1 \
    UNINSTALL_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM bash "$tmp"
)
```

自定义到应用目录外的上传、导出、备份和数据库运维目录不会被自动删除；PostgreSQL 数据库和用户、以及现有 Let’s Encrypt 证书也不会由卸载脚本自动删除。如果确实需要清除数据库，请先确认业务数据已备份，再在 PostgreSQL 中手动删除对应数据库与用户。完整删除模式还会校验绝对路径、危险目录、符号链接和安装器写入的 `shared/installation-owner` 所有权标记；旧安装缺少标记时会拒绝删除，应先重新运行当前安装器补齐标记。即使校验通过，使用自定义 `APP_BASE`/`SRC_DIR` 时仍应人工核对路径。

上述远程卸载命令使用默认服务名和默认目录。自定义过 `APP_BASE`、`SRC_DIR` 或服务名的部署，应从服务器保留的同版本源码运行卸载器，并显式传入安装时相同的变量；不要直接套用默认完整删除命令。

## 导出表格

Android App 下载页默认使用当前服务版本对应的 GitHub Release APK。无法访问 GitHub 时，可按 [VPS 部署说明](./docs/VPS_DEPLOYMENT.md) 将已签名 APK 放到服务器并设置 `APK_DOWNLOAD_URL_MANAGED=self_hosted`；后续系统更新会保留该文件。

后台导出的 CSV 表格在服务器中保存到：

```text
/var/www/laboratory-management-system/exports
```

该位置由 `EXPORT_DIR` 控制，文件默认保留 30 天，可通过 `EXPORT_RETENTION_DAYS` 设置为 1–3650 天。该目录不会由 Nginx 直接公开，不能拼接 `/uploads/exports/...` 下载；管理员应在后台“导出中心”创建任务，完成后点击下载，系统通过带登录鉴权的 `/api/v5/admin/export-jobs/:id/download` 接口返回文件。备份脚本会分别归档上传目录和导出目录。

详细安装、面板、升级和恢复说明见 [VPS 部署说明](./docs/VPS_DEPLOYMENT.md)。

## 自动备份

安装脚本会创建每日备份定时器：

```bash
systemctl list-timers | grep laboratory-management-system
```

备份文件默认保存到：

```text
/var/www/laboratory-management-system/backups
```

默认保留 14 天。自动清理只匹配本系统命名的数据库备份、清单以及 `uploads-*.tar.gz`、`exports-*.tar.gz` 归档，不会按目录年龄删除管理员手工放入的其他文件；手工文件仍应另行管理和离线备份。

## 模块结构

- `server.js`：服务启动入口。
- `src/app/create-app.js`：Express 应用组装。
- `src/config/env.js`：环境变量读取与校验。
- `src/routes/rest-api.js`：标准 REST API。
- `src/routes/wechat.js`：微信公众号回调。
- `src/routes/upload.js`：图片上传。
- `src/routes/health.js`：健康检查。
- `src/services/create-rental-service.js`：核心业务逻辑。
- `src/tasks/daily-report-scheduler.js`：每日运营日报调度。
- `public/js/admin.js`：后台页面逻辑。
- `public/js/common-header.js`：公共导航与登录提醒弹窗。
- `sql/schema.sql`：PostgreSQL 表结构和默认配置。
- `sql/migrations/`：增量数据库迁移。生产库执行涉及 `ALTER TABLE` 的迁移时，请使用表 owner 或 PostgreSQL 超级用户；普通运行账号可能没有修改既有表结构的权限。
- `scripts/install.sh`：VPS 交互式一键安装入口。
- `scripts/update.sh`：保留数据的安全更新入口。
- `scripts/backup.sh`：数据库、上传和导出文件备份入口。
- `scripts/deploy-ubuntu.sh`：部署、服务、Nginx、备份定时器配置。

## 升级数据库

升级代码后，如新增了 `sql/migrations/*.sql`，请先备份数据库，再以表 owner/超级用户执行迁移。例如：

```bash
sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -f sql/migrations/2026-06-30_long_term_upgrade_foundation.sql
```

执行后可检查关键升级对象：

```bash
sudo -u postgres psql -d laboratory_management_system -c "select to_regclass('public.device_time_slots'), to_regclass('public.reservation_items'), to_regclass('public.permissions'), to_regclass('public.calendar_events_view');"
```

## 测试阶段生成演示数据

如果当前数据库没有业务数据，可以在本地测试库执行：

```bash
npm run db:seed-demo
```

该命令会生成一批可重复覆盖的演示数据，包括用户、设备、待审核预约、已通过预约、使用中记录、已完成归还、故障报备、后台操作日志和统计分析数据。默认只允许写入 `localhost/127.0.0.1` 数据库；如果确认要在非本地测试库执行，需要显式设置 `ALLOW_NON_LOCAL_SEED=1`。

演示账号：

```text
普通用户：13800000001 / 123456
普通用户：13800000002 / 123456
待审核用户：13800000003 / 123456
超级管理员用户：13900000000 / 123456（仅本地演示数据，不是 VPS 安装默认密码）
```

生成后可打开后台查看：后台总览、数据分析、预约审核、故障报备、使用日历、统计导出和操作日志。

更多使用与维护说明：

- [前端使用说明](./docs/frontend-usage.md)
- [后端使用说明](./docs/backend-usage.md)
- [模块维护说明](./docs/module-map.md)

## 重要说明

微信不提供已发送消息的通用撤回/删除 API。本项目的“覆盖昨日记录”指每天推送新的日报，让管理员以最新日报为准，不代表可以从微信聊天记录里撤回旧消息。
