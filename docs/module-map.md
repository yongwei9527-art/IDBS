# 模块维护说明

这份文档用于后续升级时快速判断“应该改哪里”。当前项目已经按启动层、应用层、路由层、服务层、数据层和前端页面层拆分。

## 后端模块

| 位置 | 作用 | 常见修改场景 |
| --- | --- | --- |
| `server.js` | 启动服务、创建数据库连接、注册优雅退出 | 修改启动日志、服务生命周期 |
| `src/config/env.js` | 读取 `.env`，生成运行配置和 `/ready` 警告 | 新增环境变量、配置校验 |
| `src/app/create-app.js` | 组装 Express 中间件、静态目录和路由 | 新增全局中间件、CORS、限流 |
| `src/routes/rest-api.js` | 标准 REST API 路由 | 小程序/H5 新接口优先改这里 |
| `src/routes/upload.js` | 图片上传接口 | 调整上传大小、图片类型、目录 |
| `src/routes/wechat.js` | 微信公众号服务器回调 | 修改验证码消息、公众号事件处理 |
| `src/routes/health.js` | `/health` 和 `/ready` | 增加运行状态检查 |
| `src/tasks/daily-report-scheduler.js` | 每日运营日报定时调度 | 调整日报推送时间、失败重试 |
| `src/lib/db.js` | PostgreSQL 连接池 | 调整连接池、SSL、超时 |
| `src/lib/security.js` | 请求日志、设备识别、内存限流 | 调整限流策略、日志字段 |
| `src/lib/http.js` | 统一响应体和错误处理 | 修改错误码、响应结构 |
| `src/services/create-rental-service.js` | 服务组合入口和共享基础能力 | 注入领域服务依赖、维护跨领域兼容辅助函数 |
| `src/services/core/` | 公共工具 | 校验、加密、日期、响应包装、聊天辅助 |
| `src/services/domains/auth/auth-service.js` | 认证领域服务 | 管理员密码登录、普通用户密码登录、普通密码注册关闭响应 |
| `src/services/domains/users/user-service.js` | 用户领域服务 | 用户资料、通知已读、后台用户列表/详情、禁用/删除、封禁、解绑微信 |
| `src/services/domains/devices/` | 设备领域服务 | 设备列表/详情、时间段、设备新增/更新/恢复 |
| `src/services/domains/reservations/reservation-read-service.js` | 预约只读领域服务 | 日历事件、用户预约批次、后台预约和批次查询 |
| `src/services/domains/reservations/reservation-action-service.js` | 预约事务领域服务 | 预约预检、创建、取消和后台审批 |
| `src/services/domains/reservations/borrow-return-service.js` | 借还事务领域服务 | 开始使用、提交归还、异常归还状态流转 |
| `src/services/domains/chat/chat-service.js` | 聊天领域服务 | 会话、成员、消息、SSE、实验管理总群 |
| `src/services/domains/wechat/wechat-service.js` | 微信登录/回调领域服务 | 公众号校验/回调、验证码登录、账号绑定、XML 回复 |
| `src/services/domains/wechat/wechat-push-service.js` | 微信推送领域服务 | 客服文本消息、每日使用日报生成/推送、推送日志 |
| `src/services/domains/admin/dashboard-service.js` | 后台工作台 | KPI、待办和总览统计 |
| `src/services/domains/admin/system-service.js` | 后台系统管理 | 安全配置、权限选项、角色授权、操作日志和系统选项 |
| `src/services/domains/analytics/analytics-service.js` | 统计分析领域服务 | 使用统计、后台总览趋势、设备使用排行、时段热力、故障统计 |
| `src/services/domains/faults/fault-request-service.js` | 故障与诉求领域服务 | 用户故障报备、用户诉求、后台故障和诉求处理 |
| `src/services/domains/reports/export-service.js` | 导出任务 | `export_jobs` 创建、列表、CSV 文件生成和任务执行 |

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

## 使用说明文档

| 位置 | 作用 |
| --- | --- |
| `docs/frontend-usage.md` | 前端页面入口、用户流程、管理员流程和本地调试说明 |
| `docs/backend-usage.md` | 后端启动配置、数据库、REST API、上传、微信、检查和运维说明 |

## 推荐升级顺序

1. 新增接口时，先在 `docs/api-contract.md` 写清楚入参和出参。
2. 优先在 `src/services/domains/*/` 增加业务方法，再由 `src/services/create-rental-service.js` 组合导出。
3. 在 `src/routes/rest-api.js` 暴露 REST 路由。
4. 修改对应的 `public/js/*.js` 和 HTML 页面。
5. 执行 `npm run check`，必要时先确认 3000 端口不是旧服务，再执行 `npm run smoke -- http://127.0.0.1:3000`；本地并行验证可用独立端口。

## 下一步可继续拆分

服务层主要业务域已迁入 `src/services/domains/*`。后续继续瘦身 `src/services/create-rental-service.js` 时，优先迁出仍留在组合入口里的共享兼容辅助能力，例如通知、操作日志、预约可见性和设备快照工具；迁出时保持领域服务通过 context 注入依赖，避免循环引用。
