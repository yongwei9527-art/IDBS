# 模块维护说明

这份文档用于后续升级时快速判断“应该改哪里”。当前项目已经按启动层、应用层、路由层、服务层、数据层和前端页面层拆分。

## 后端模块

| 位置 | 作用 | 常见修改场景 |
| --- | --- | --- |
| `server.js` | 启动服务、创建数据库连接、注册优雅退出 | 修改启动日志、服务生命周期 |
| `src/config/env.js` | 读取 `.env`，生成运行配置和 `/ready` 警告 | 新增环境变量、配置校验 |
| `src/app/create-app.js` | 组装 Express 中间件、静态目录和路由 | 新增全局中间件、CORS、限流 |
| `src/routes/rest-api.js` | 标准 REST API 路由 | 小程序/H5 新接口优先改这里 |
| `src/routes/legacy-api.js` | 兼容旧版 `POST /api/:action` | 旧页面过渡期保留 |
| `src/routes/upload.js` | 图片上传接口 | 调整上传大小、图片类型、目录 |
| `src/routes/wechat.js` | 微信公众号服务器回调 | 修改验证码消息、公众号事件处理 |
| `src/routes/health.js` | `/health` 和 `/ready` | 增加运行状态检查 |
| `src/tasks/daily-report-scheduler.js` | 每日运营日报定时调度 | 调整日报推送时间、失败重试 |
| `src/lib/db.js` | PostgreSQL 连接池 | 调整连接池、SSL、超时 |
| `src/lib/security.js` | 请求日志、设备识别、内存限流 | 调整限流策略、日志字段 |
| `src/lib/http.js` | 统一响应体和错误处理 | 修改错误码、响应结构 |
| `src/services/create-rental-service.js` | 核心业务逻辑和 SQL | 用户、设备、预约、借还、统计、配置 |

## 前端模块

| 位置 | 作用 |
| --- | --- |
| `public/js/config.js` | API 地址配置 |
| `public/js/api.js` | 前端请求封装、token 存取、上传封装 |
| `public/js/ui.js` | 通用提示、toast、登录拦截 |
| `public/js/common-header.js` | 公共导航、角色菜单、登录注意事项弹窗 |
| `public/js/admin.js` | 管理后台逻辑，包括设备、用户、预约、系统配置、统计 |
| `public/css/style.css` | 整体视觉样式 |
| `public/*.html` | H5 页面结构 |

## 推荐升级顺序

1. 新增接口时，先在 `docs/api-contract.md` 写清楚入参和出参。
2. 在 `src/services/create-rental-service.js` 增加业务方法。
3. 在 `src/routes/rest-api.js` 暴露 REST 路由。
4. 修改对应的 `public/js/*.js` 和 HTML 页面。
5. 执行 `npm run check`，必要时再执行 `npm run smoke -- http://127.0.0.1:3000`。

## 下一步可继续拆分

当前最值得继续拆分的是 `src/services/create-rental-service.js`。建议按业务域逐步拆成：

- `src/services/auth-service.js`
- `src/services/user-service.js`
- `src/services/device-service.js`
- `src/services/reservation-service.js`
- `src/services/admin-service.js`
- `src/services/report-service.js`

本轮没有一次性把服务层全部拆开，是为了避免 SQL、业务状态和页面联调同时移动导致风险过高。现在入口层和前端后台已清晰，下一轮可以按业务域逐个拆。
