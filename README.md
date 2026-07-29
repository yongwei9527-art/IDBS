# 实验室管理系统

> **应用版本：实验室管理系统 0.1。当前 GitHub 发布标签：v5.0.4。** The canonical API and realtime contract is [docs/v5-api-contract.md](./docs/v5-api-contract.md). `/v5/` and `/api/v5` are stable compatibility paths, not the product version.

实验室管理系统 是一套面向 Ubuntu VPS 的设备预约、借还、图片归还、微信绑定和后台管理系统。后端使用 Node.js + Express，数据库使用 PostgreSQL，前端静态页面位于 `public/`。

使用或部署前，请先阅读 [免责声明](./DISCLAIMER.md)。


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
- CI：推送新的 v* 标签时，.github/workflows/android-release.yml 会从 GitHub Secrets 临时恢复 keystore，构建签名 APK 与 AAB、生成 SHA256SUMS.txt 并创建 GitHub Release。
- GitHub Secrets：ANDROID_RELEASE_KEYSTORE_BASE64、ANDROID_RELEASE_STORE_PASSWORD、ANDROID_RELEASE_KEY_ALIAS、ANDROID_RELEASE_KEY_PASSWORD。只在仓库或 Environment 的 Secrets 中设置，绝不写入代码、文档或聊天。
- 只有配置上述签名材料并通过构建验证后，新的 tag 才会产出正式签名包；当前 v5.0.4 仍是 debug 签名内部测试包。

后台、锁屏或应用关闭后的可靠消息推送仍需要单独的 Firebase 项目配置、设备令牌管理和服务端凭据；这些材料尚未提供，因此没有将任何 Firebase 凭据或配置文件加入仓库。

## v5.0.2 用户运营与移动端适配

本版完成最高管理员的用户运营视图与移动端可读性优化：

- **用户运营概览**：最高管理员可查看注册人数、待审核、正常用户、近 14 天注册趋势和设备使用状态汇总；
- **最近注册用户**：以个人信息卡展示姓名、状态、专业、导师、学号和注册时间，并可进入现有用户档案抽屉；
- **移动端资料卡**：用户管理及系统信息维护在手机和平板竖屏改为清晰的资料卡列表，避免横向挤压表格；
- **权限边界**：`/admin/system/operations-overview` 仅允许 `super_admin` 查询，普通管理员不会发起该请求。

## 一键安装

在 Ubuntu 22.04/24.04 VPS 终端执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

安装脚本会先把 VPS 调整到适合安装 实验室管理系统 的状态，然后自动完成 Node.js、Nginx、PostgreSQL、数据库初始化、systemd 服务、反向代理、每日数据库备份和默认运行配置。

如果你想先单独整理 VPS 环境，再安装，可以执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh)
```

准备脚本默认不会删除业务数据库。只有确认要彻底重装时，才使用下面这个危险命令：

```bash
RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh)
```

安装完成后终端会显示初始后台密码：

```bash
Initial admin password: LABORATORY_MANAGEMENT_SYSTEM_xxxxxxxxxxxx
```

安装脚本会询问“服务器是否有域名”，请按实际情况选择：

| 方式 | 浏览器访问 | APK 登录页填写 | 说明 |
| --- | --- | --- | --- |
| 有域名（推荐） | `https://你的域名/` | `你的域名` 或 `https://你的域名` | 生产推荐，HTTPS 加密传输。 |
| 无域名 | `http://服务器公网IP/` | `服务器公网IP` | 可先用 IP 跑通；公网 IP 通常无法申请浏览器信任的免费 HTTPS 证书。 |
| 本地/局域网调试 | `http://电脑局域网IP:3000/` | `电脑局域网IP:3000` | 仅适合开发调试。 |

APK 内不写死服务器地址。登录页会自动识别：域名默认补 `https://`，IP/localhost 默认补 `http://`；后端安装脚本会把 APK WebView 来源 `https://localhost` 加入 `CORS_ORIGIN`。

如果访问 IP 时看到 `Welcome to nginx!`，说明 Nginx 默认站点抢占了请求。重新执行一键安装命令即可自动修复默认站点：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
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
sudo systemctl status laboratory_management_system
```

查看实时日志：

```bash
sudo journalctl -u laboratory_management_system -f
```

重启服务：

```bash
sudo systemctl restart laboratory_management_system
```

重置后台管理员密码（VPS 一键安装/更新后可用）：

```bash
sudo laboratory-management-system-reset-admin-password
```

命令会要求输入两次新密码，输入时不会回显。也可以用于自动化脚本：

```bash
sudo ADMIN_NEW_PASSWORD='新的强密码至少8位' laboratory-management-system-reset-admin-password
```

检查接口：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

更新到 GitHub 最新版本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

一键卸载/清除 实验室管理系统 相关文件与服务：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/uninstall-vps.sh)
```

该命令会停止并移除 实验室管理系统 的 systemd 服务、清理 Nginx 配置、删除站点文件；如果数据库也需要一并清除，请先确认业务数据已备份，然后在 PostgreSQL 中删除对应数据库与用户。

## 自动备份

安装脚本会创建每日备份定时器：

```bash
systemctl list-timers | grep laboratory_management_system
```

备份文件默认保存到：

```text
/var/www/laboratory-management-system/backups
```

默认保留 14 天。

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
- `scripts/install-vps.sh`：VPS 一键安装入口。
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
超级管理员用户：13900000000 / 123456
```

生成后可打开后台查看：后台总览、数据分析、预约审核、故障报备、使用日历、统计导出和操作日志。

更多使用与维护说明：

- [前端使用说明](./docs/frontend-usage.md)
- [后端使用说明](./docs/backend-usage.md)
- [模块维护说明](./docs/module-map.md)

## 重要说明

微信不提供已发送消息的通用撤回/删除 API。本项目的“覆盖昨日记录”指每天推送新的日报，让管理员以最新日报为准，不代表可以从微信聊天记录里撤回旧消息。

