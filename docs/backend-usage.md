# 后端使用说明

本文面向部署、运维和后端维护人员，说明 IDBS 后端的启动方式、配置项、接口分组、数据库、定时任务和常见检查命令。后端使用 Node.js + Express + PostgreSQL。

## 1. 运行架构

| 层级 | 位置 | 说明 |
| --- | --- | --- |
| 启动入口 | `server.js` | 加载 `.env`、创建上传目录、初始化数据库连接池和业务服务、启动 HTTP 服务、注册优雅退出 |
| 应用组装 | `src/app/create-app.js` | 注册安全响应头、请求日志、CORS、JSON/form 解析、静态资源、上传、REST API、微信回调和健康检查 |
| 配置读取 | `src/config/env.js` | 读取端口、密钥、数据库、上传目录、CORS、微信配置，并生成 `/ready` 运行状态 |
| 数据库连接 | `src/lib/db.js` | PostgreSQL 连接池、查询封装和健康检查 |
| 安全与日志 | `src/lib/security.js` | 请求 ID、访问日志、设备识别和内存限流 |
| HTTP 响应 | `src/lib/http.js` | 统一成功/失败响应体和错误处理 |
| 路由 | `src/routes/rest-api.js` | 标准 REST API 路由 |
| 上传 | `src/routes/upload.js` | `POST /api/upload`，限制 10 MB、校验图片 MIME 和文件签名 |
| 微信 | `src/routes/wechat.js` | 公众号服务器验证和消息回调 |
| 健康检查 | `src/routes/health.js` | `/health` 和 `/ready` |
| 业务服务 | `src/services/create-rental-service.js`、`src/services/domains/` | 组合认证、用户、设备、预约、借还、聊天、微信、后台、故障诉求、导出等领域服务 |
| 定时任务 | `src/tasks/daily-report-scheduler.js` | 每日运营日报推送调度 |

## 2. 环境变量

生产环境通常由 `/var/www/idbs/shared/.env` 提供配置。本地开发可在项目根目录创建 `.env`。

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `PORT` | 否 | `3000` | HTTP 监听端口，默认 `3000` |
| `ADMIN_PASSWORD` | 是 | `IDBS_xxx` | 初始/兼容管理员密码；上线后应在后台修改 |
| `TOKEN_SECRET` | 是 | `long-random-secret` | 登录 token 签名密钥，生产必须使用强随机值 |
| `UPLOAD_DIR` | 否 | `/var/www/idbs/uploads` | 上传图片保存目录，默认项目根目录下 `uploads` |
| `DATABASE_URL` | 是 | `postgresql://idbs_user:password@127.0.0.1:5432/idbs` | PostgreSQL 连接串 |
| `PGSSL` | 否 | `false` | 外部数据库需要 SSL 时设为 `true` |
| `CORS_ORIGIN` | 否 | `https://your-domain.com` | 允许跨域来源；生产建议限制为正式域名 |
| `WECHAT_TOKEN` | 否 | `token` | 微信公众号服务器配置 Token |
| `WECHAT_APP_ID` | 否 | `wx...` | 公众号 AppID |
| `WECHAT_APP_SECRET` | 否 | `secret` | 公众号 AppSecret，需与 AppID 同时配置 |
| `WECHAT_ADMIN_OPENIDS` | 否 | `openid_a,openid_b` | 接收每日运营日报的管理员 OpenID 列表 |
| `API_RATE_LIMIT_MAX` | 否 | `120` | 每分钟 API 内存限流阈值，默认 `120` |

`/ready` 会根据关键配置生成运行状态。如果 `ADMIN_PASSWORD`、`TOKEN_SECRET`、`DATABASE_URL` 缺失或使用默认占位值，`/ready` 会返回降级状态。

## 3. 启动与部署

### 3.1 本地启动

```bash
npm install
npm run dev
```

启动后访问：

```text
http://127.0.0.1:3000/health
http://127.0.0.1:3000/ready
http://127.0.0.1:3000/
```

### 3.2 Ubuntu VPS 一键安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

安装脚本会配置 Node.js、Nginx、PostgreSQL、数据库初始化、systemd 服务、反向代理、备份定时器和默认运行配置。安装完成后浏览器访问服务器公网 IP 或绑定域名即可。

### 3.3 systemd 运维命令

```bash
sudo systemctl status idbs
sudo journalctl -u idbs -f
sudo systemctl restart idbs
```

## 4. 数据库使用

### 4.1 初始化与迁移

常用脚本：

```bash
npm run db:migrate
npm run db:upgrade-schema
npm run db:reset-schema
```

生产升级前必须先备份数据库。涉及既有表 `ALTER TABLE` 的迁移建议使用表 owner 或 PostgreSQL 超级用户执行，避免运行账号权限不足。

示例：

```bash
sudo -u postgres psql -d idbs -v ON_ERROR_STOP=1 -f sql/migrations/2026-06-30_long_term_upgrade_foundation.sql
```

### 4.2 演示数据

本地空库可生成演示数据：

```bash
npm run db:seed-demo
```

或重置演示库：

```bash
npm run demo:reset
```

默认只允许写入本地数据库；如需非本地测试库，必须显式设置 `ALLOW_NON_LOCAL_SEED=1`。

## 5. REST API 分组

所有新客户端都应使用 REST API。旧版 `POST /api/:action` 兼容入口已移除。详细字段见 [API Contract](./api-contract.md)。

| 分组 | 典型接口 | 说明 |
| --- | --- | --- |
| 认证 | `POST /api/auth/login`、`POST /api/admin/auth/login`、`GET /api/login/challenge`、`POST /api/login/bind` | 普通登录、管理员登录、公众号验证码和绑定 |
| 用户 | `GET /api/users/profile`、`GET /api/bookings/me` | 当前用户资料、预约和借还记录 |
| 设备 | `GET /api/devices`、`GET /api/devices/:deviceCode` | 设备列表、设备详情、占用和故障摘要 |
| 上传 | `POST /api/upload` | 图片上传，表单字段为 `file` |
| 预约/借还 | `POST /api/bookings/precheck`、`POST /api/bookings`、`POST /api/borrow-records`、`PUT /api/borrow-records/:recordId/return` | 预约预检、创建预约、开始使用、提交归还 |
| 通知 | `GET /api/notifications`、`PATCH /api/notifications/read` | 用户通知列表和已读 |
| 聊天 | `GET /api/chat/conversations`、`POST /api/chat/conversations/:id/messages`、`GET /api/chat/events` | 会话、消息、成员和 SSE 实时事件 |
| 预约批次/明细 | `POST /api/reservation-batches`、`GET /api/reservation-batches/me`、`PATCH /api/reservation-items/:id/cancel` | 多设备多日期预约模型 |
| 后台 | `/api/admin/*` | 用户、设备、预约、统计、导出、权限、安全配置、故障诉求和日报 |
| 微信回调 | `GET /wechat`、`POST /wechat` | 公众号服务器验证和消息处理 |

统一成功响应包含：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {},
  "request_id": "...",
  "server_time": "2026-07-02T02:30:00.000Z"
}
```

统一失败响应包含：

```json
{
  "ok": false,
  "code": 2001,
  "message": "request failed",
  "data": null,
  "request_id": "...",
  "server_time": "2026-07-02T02:30:00.000Z"
}
```

## 6. 文件上传

- 接口：`POST /api/upload`
- Content-Type：`multipart/form-data`
- 字段名：`file`
- 大小限制：10 MB
- 支持类型：JPEG、PNG、WebP、GIF
- 校验方式：同时检查 MIME 类型和文件签名
- 返回：上传后的 `/uploads/<filename>` URL

上传目录由 `UPLOAD_DIR` 控制，Express 会以 `/uploads` 静态路径提供访问。

## 7. 微信公众号能力

| 能力 | 相关配置/接口 |
| --- | --- |
| 服务器验证 | `WECHAT_TOKEN`、`GET /wechat` |
| 验证码登录/绑定 | `GET /api/login/challenge`、公众号消息、`GET /api/login/status`、`POST /api/login/bind` |
| 客服文本消息 | `WECHAT_APP_ID`、`WECHAT_APP_SECRET` |
| 每日运营日报 | `WECHAT_ADMIN_OPENIDS`、后台日报配置、`src/tasks/daily-report-scheduler.js` |

注意：微信不提供已发送公众号消息的通用撤回/删除 API。每日运营日报会发送新消息作为最新参考。

## 8. 检查与验收

### 8.1 代码检查

```bash
npm run check
```

该命令会检查后端/前端脚本语法、HTML 内联脚本和乱码。

### 8.2 冒烟测试

服务启动后执行：

```bash
npm run smoke -- http://127.0.0.1:3000
```

如 3000 端口可能被旧服务占用，建议先确认端口进程，或使用独立端口启动本地服务。

### 8.3 运行状态

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

- `/health` 用于确认 HTTP 服务存活。
- `/ready` 会检查关键配置和数据库健康状态；生产上线前应返回 `200` 且无关键警告。

## 9. 常见问题

| 问题 | 排查方向 |
| --- | --- |
| `/ready` 返回 503 | 检查 `.env`、`DATABASE_URL`、`TOKEN_SECRET`、`ADMIN_PASSWORD` 和数据库连接 |
| 前端请求 401 | token 过期或角色不匹配，清理本地登录状态后重新登录 |
| 后台接口权限不足 | 检查管理员角色和权限配置 |
| 上传失败 | 检查文件大小、图片格式、上传目录权限和 Nginx 请求体限制 |
| 数据库迁移失败 | 使用表 owner/PostgreSQL 管理员执行迁移，查看 `npm run db:upgrade-schema` 输出的 Manual SQL |
| 频繁请求出现 429 | 本地测试可临时调高 `API_RATE_LIMIT_MAX`，生产需确认是否存在异常流量 |
| IP 访问被拦截 | 后台可能开启了禁止 IP 直连，请改用配置的正式域名访问 |
