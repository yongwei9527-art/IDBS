# 模块维护说明

这份文档用于后续升级时快速判断“应该改哪里”。IDBS 现在按启动层、应用层、路由层、服务层、数据层拆分。

## 后端模块

| 位置 | 作用 | 常见修改场景 |
| --- | --- | --- |
| `server.js` | 只负责启动服务、创建数据库连接、注册退出钩子 | 修改启动端口、启动日志、优雅退出 |
| `src/config/env.js` | 读取 `.env`，生成运行配置和 `/ready` 警告 | 新增环境变量、安全检查 |
| `src/app/create-app.js` | 组装 Express 中间件、静态目录和路由 | 新增全局中间件、调整 CORS、调整限流 |
| `src/routes/rest-api.js` | 标准 REST API 路由 | 给小程序或 H5 新增接口 |
| `src/routes/legacy-api.js` | 兼容旧的 `POST /api/:action` | 旧页面还没迁移时保留 |
| `src/routes/upload.js` | 图片上传接口 | 调整上传大小、允许的图片类型、上传路径 |
| `src/routes/wechat.js` | 微信公众号服务器回调 | 修改验证码消息、公众号事件处理 |
| `src/routes/health.js` | `/health` 和 `/ready` | 增加运行状态检查 |
| `src/tasks/daily-report-scheduler.js` | 每日运营日报定时推送 | 调整推送时间逻辑、失败重试 |
| `src/lib/db.js` | PostgreSQL 连接池 | 调整连接池大小、SSL、连接超时 |
| `src/lib/security.js` | 请求日志、设备识别、内存限流 | 调整限流策略、日志字段 |
| `src/lib/http.js` | 统一响应体和错误处理 | 修改错误码、响应结构 |
| `src/services/create-rental-service.js` | 核心业务逻辑和 SQL | 用户、设备、预约、借还、统计等业务改动 |

## 前端模块

| 位置 | 作用 |
| --- | --- |
| `public/js/config.js` | API 地址配置 |
| `public/js/api.js` | 前端请求封装 |
| `public/js/ui.js` | 通用 UI 交互 |
| `public/js/common-header.js` | 公共导航和角色菜单 |
| `public/css/style.css` | 页面整体视觉样式 |
| `public/*.html` | H5 页面 |

## 推荐升级顺序

1. 新增接口时，先在 `docs/api-contract.md` 写清楚入参和出参。
2. 再在 `src/services/create-rental-service.js` 增加业务方法。
3. 然后在 `src/routes/rest-api.js` 暴露 REST 路由。
4. 最后修改 `public/js/api.js` 和对应 HTML 页面。
5. 每次改完执行 `npm run check`、`npm run smoke -- http://127.0.0.1:3000`。

## 近期可以继续拆分的地方

当前最值得继续拆的是 `src/services/create-rental-service.js`。建议下一轮按以下业务域拆：

- `src/services/auth-service.js`
- `src/services/user-service.js`
- `src/services/device-service.js`
- `src/services/reservation-service.js`
- `src/services/admin-service.js`
- `src/services/report-service.js`

这次没有直接把服务层一次性拆完，是为了避免 SQL 和业务状态机同时移动导致联调风险过高。现在入口层已经干净，下一轮可以按业务域逐个拆。
