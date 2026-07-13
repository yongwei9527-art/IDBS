# IDBS

> **Current release: IDBS 5.0.0.** The canonical API and realtime contract is [docs/v5-api-contract.md](./docs/v5-api-contract.md). `/v5/` and `/api/v5` are stable compatibility paths, not the product version.

IDBS 是一套面向 Ubuntu VPS 的设备预约、借还、图片归还、微信绑定和后台管理系统。后端使用 Node.js + Express，数据库使用 PostgreSQL，前端静态页面位于 `public/`。

使用或部署前，请先阅读 [免责声明](./DISCLAIMER.md)。

## 一键安装

在 Ubuntu 22.04/24.04 VPS 终端执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

安装脚本会先把 VPS 调整到适合安装 IDBS 的状态，然后自动完成 Node.js、Nginx、PostgreSQL、数据库初始化、systemd 服务、反向代理、每日数据库备份和默认运行配置。

如果你想先单独整理 VPS 环境，再安装，可以执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh)
```

准备脚本默认不会删除业务数据库。只有确认要彻底重装时，才使用下面这个危险命令：

```bash
RESET_IDBS_DATA=1 bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh)
```

安装完成后终端会显示初始后台密码：

```bash
Initial admin password: IDBS_xxxxxxxxxxxx
```

浏览器访问服务器公网 IP 即可打开系统，例如：

```text
http://你的服务器IP/
```

如果没有域名，请先使用 `http://服务器IP/`。公网 IP 默认无法申请浏览器信任的免费 HTTPS 证书，因此不建议预设为 `https://IP`。后续绑定域名后，再配置 HTTPS 会更稳。

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

默认情况下不需要手动编辑 `/var/www/idbs/shared/.env`。如果你误打开 `.env` 看到空白或提示 `No such file or directory`，直接重新执行上面的一键安装命令即可。

## 运维命令

查看服务状态：

```bash
sudo systemctl status idbs
```

查看实时日志：

```bash
sudo journalctl -u idbs -f
```

重启服务：

```bash
sudo systemctl restart idbs
```

重置后台管理员密码（VPS 一键安装/更新后可用）：

```bash
sudo idbs-reset-admin-password
```

命令会要求输入两次新密码，输入时不会回显。也可以用于自动化脚本：

```bash
sudo ADMIN_NEW_PASSWORD='新的强密码至少8位' idbs-reset-admin-password
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

一键卸载/清除 IDBS 相关文件与服务：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/uninstall-vps.sh)
```

该命令会停止并移除 IDBS 的 systemd 服务、清理 Nginx 配置、删除站点文件；如果数据库也需要一并清除，请先确认业务数据已备份，然后在 PostgreSQL 中删除对应数据库与用户。

## 自动备份

安装脚本会创建每日备份定时器：

```bash
systemctl list-timers | grep idbs
```

备份文件默认保存到：

```text
/var/www/idbs/backups
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
sudo -u postgres psql -d idbs -v ON_ERROR_STOP=1 -f sql/migrations/2026-06-30_long_term_upgrade_foundation.sql
```

执行后可检查关键升级对象：

```bash
sudo -u postgres psql -d idbs -c "select to_regclass('public.device_time_slots'), to_regclass('public.reservation_items'), to_regclass('public.permissions'), to_regclass('public.calendar_events_view');"
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
