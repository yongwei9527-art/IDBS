# IDBS 3.0 大升级方案

> **Historical record.** Current IDBS 5.0 release material is [v5-release.md](./v5-release.md) and [v5-api-contract.md](./v5-api-contract.md).

更新时间：2026-07-04

## 总目标

把 IDBS 从"Node + 原生静态页 → 设备预约借还系统"升级为"React + shadcn/ui 前端 + 精简后端 + 干净数据库"的现代化设备管理平台。一次性大重构，不兼容旧前端代码，旧数据通过迁移脚本导入。聊天功能保留并升级。

## 设计参考

- **[Element Plus Input](https://element-plus.org/zh-CN/component/input)**：借鉴其输入交互细节——`clearable` 一键清空、`show-password` 密码可见切换、`formatter/parser` 格式化、`prefix/suffix` 图标插槽、`prepend/append` 复合输入、`maxlength + show-word-limit` 字数统计、`size` 三档尺寸、`autosize` 自适应文本域。3.0 前端用 shadcn Input 复刻这些交互能力 + Tailwind variants 实现尺寸/清空/字数等。
- **[shadcn/ui Blocks](https://ui.shadcn.com/blocks)**：借用 `dashboard-01`（Sidebar + SectionCards + ChartAreaInteractive + DataTable）、`sidebar-07`/`sidebar-03`（可折叠侧边栏 + 面包屑）、`login-03`/`login-04`（登录页结构）作为后台与登录页骨架。

## 核心原则

- 前端一次性重写为 React + TypeScript + shadcn/ui + Tailwind v4。
- 后端保留 Node + Express，精简为"鉴权 + REST 资源 + WebSocket"三块，聊天从 SSE 迁到 WebSocket。
- 数据库保留 PostgreSQL，沿用 2.0 的 `reservation_batches + reservation_items` 模型与全部聊天表，新增审计/软删/枚举约束。
- 旧数据备份后用 `scripts/migrate-2-to-3.js` 导入新库。
- 视觉柔和克制：浅灰底 + 圆角 + 1px 边框 + 系统字体栈，参考 shadcn new-york 风格。
- 每个阶段可 `npm run check` + Playwright 验收，可回滚到 2.x 分支。

## 技术栈

- 前端：React 18、TypeScript、Vite、shadcn/ui、Tailwind v4、TanStack Query、TanStack Router、recharts、lucide-react、Sonner（toast）、Vite 构建产物嵌入 Express 静态目录或独立 SPA。
- 后端：Node 20、Express 5（保留）、`pg`、`zod`（请求校验）、JWT（替换原 token 方案）、ws（实时通知 + 聊天）。
- 数据库：PostgreSQL 15+，沿用表结构 + 增量迁移。
- 测试：Vitest（前端单测）+ Playwright（E2E，保留）。
- 部署：VPS Nginx + systemd 不变，前端 `npm run build` 产物由 Express 托管或 Nginx 直出。

## 数据库升级（3.0 基线）

在 `sql/schema.sql` 基础上新增迁移 `sql/migrations/2026-07-04_v3_foundation.sql`：

1. 枚举约束化：为 `users.status`、`devices.status`、`reservations.status`、`reservation_items.status`、`borrow_records.status`、`device_fault_reports.status`、`user_requests.status` 增加 `CHECK` 约束（目前是注释式自由文本）。
2. 软删除：给业务表加 `deleted_at TIMESTAMPTZ`，查询统一 `WHERE deleted_at IS NULL`；保留硬删除外键。
3. 审计字段统一：`created_by`、`updated_by` UUID 引用 `users`，补到 `devices`、`reservations`、`reservation_items`、`reservation_batches`、`borrow_records`、`device_fault_reports`、`user_requests`。
4. 时间段强化：`device_time_slots` 增加 `capacity INTEGER DEFAULT 1`（同一时段可容纳人数），为后续多预约并发预留。
5. 通知表扩展：`user_notifications` 增加 `action_url TEXT`、`level TEXT DEFAULT 'info'`（info/warning/success），适配前端 Toast + 通知中心。
6. 聊天表保留并增强：`chat_conversations`/`chat_participants`/`chat_messages`/`chat_message_reads` 全部保留；`chat_conversations` 增加 `last_message_preview TEXT`、`last_message_type TEXT` 冗余字段，减少列表查询连表；补充 `(user_id, conversation_id)` 的已读游标索引。`lab_management` 系统总群保留为公告能力载体。
7. 新增 `audit_logs` 统一操作日志，替代零散的 `operation_logs` + `user_activity_logs`（保留旧表只读归档）。
8. 视图更新：`calendar_events_view`、`device_usage_summary_view` 增加 `deleted_at` 过滤。
9. 微信字段独立表：`user_wechat_bindings (user_id, openid, unionid, nickname, bound_at)`，`users.wechat_openid` 改为冗余快照，支持一个用户多公众号绑定。

## 后端升级

### 模块重构（`src/`）

| 新位置 | 作用 | 替代旧位置 |
| --- | --- | --- |
| `src/config/env.js` | 环境变量 + zod 校验 | 保留，强化 |
| `src/lib/db.js` | PG 连接池 + 事务 helper | 保留 |
| `src/lib/auth.js` | JWT 签发/校验 + 权限中间件 | 新增，替换原 token |
| `src/lib/http.js` | 统一响应 + 错误码 | 保留，对齐 RFC 7807 problem+json |
| `src/lib/validate.js` | zod schema 复用 | 新增 |
| `src/lib/ws.js` | WebSocket 网关（通知 + 聊天） | 新增，替代 SSE |
| `src/routes/auth.js` | 登录/注册/挑战/绑定/JWT 刷新 | `rest-api.js` 前段 |
| `src/routes/chat.js` | 会话/成员/消息/已读 | 抽离自 `rest-api.js` 聊天段 |
| `src/routes/devices.js` | 设备 + 时间段 | 抽离 |
| `src/routes/reservations.js` | 预约批次/明细/日历 | 抽离 |
| `src/routes/borrow.js` | 借还 + 故障 | 抽离 |
| `src/routes/admin/*` | 后台用户/设备/预约/故障/统计/导出/系统 | 按域拆 |
| `src/routes/wechat.js` | 公众号回调 + 推送 | 保留 |
| `src/routes/health.js` | `/health` `/ready` | 保留 |
| `src/services/*` | 保留 2.0 全部领域服务（含 `chat-service`） | 增量 |

### API 契约（3.0 REST）

- 统一前缀 `/api/v5/`，旧 `/api/*`（2.0）保留一个迁移期反向代理窗口。
- 响应结构统一：`{ code: 0, data: T, message: string }`，错误用 HTTP 状态码 + `application/problem+json`。
- 鉴权：`Authorization: Bearer <jwt>`，token 15 分钟 + refresh token 7 天。
- 关键端点（节选，完整见 `docs/api-contract.md` 更新）：
  - `POST /api/v5/auth/login`、`/auth/register`、`/auth/refresh`、`/auth/logout`
  - `GET /api/v5/me`、`PATCH /api/v5/me`
  - `GET /api/v5/devices`、`/devices/:id`、`GET /devices/:id/slots`
  - `POST /api/v5/reservation-batches`（预检 `/precheck`）、`GET /reservation-batches/me`、`PATCH /reservation-items/:id/cancel`
  - `POST /api/v5/borrow-records`、`PUT /borrow-records/:id/return`、`POST /fault-reports`
  - `GET /api/v5/calendar`、`/calendar/days/:date`
  - `GET /api/v5/notifications`、`PATCH /notifications/read`
  - 聊天：`GET /api/v5/chat/conversations`、`POST /api/v5/chat/conversations`、`GET /api/v5/chat/conversations/:id/messages`、`POST /api/v5/chat/conversations/:id/messages`、`PATCH /chat/conversations/:id/read`、成员增删
  - `WS /api/v5/ws`：合并实时通知 + 聊天消息推送 + 输入中 + 已读回执，替代旧 `/chat/events` SSE
  - `GET /api/v5/admin/dashboard`、`/admin/users`、`/admin/reservations`、`/admin/faults`、`/admin/stats/*`、`POST /admin/export-jobs`
  - `GET /api/v5/wechat/callback`、`POST /wechat/push/daily-report`

### 实时方案（聊天 + 通知统一）

- 删除 SSE `/chat/events`，新增 `src/lib/ws.js` 基于 `ws` 的 WebSocket 网关。
- 单连接多频道：`notifications`（系统通知/审批结果/借还状态）、`chat:<conversationId>`（消息、已读、输入中、撤回）。
- 消息多端同步：基于 `client_message_id` 幂等，`chat_message_reads` 维护已读游标。
- 前端 `useWebSocket` hook 订阅，Sonner toast 弹通知，聊天页用 WebSocket 替代轮询。

## 前端升级（核心）

### 目录结构（`web/`，与 `public/` 并存，构建后输出到 `public/`）

```
web/
  package.json
  vite.config.ts
  tsconfig.json
  components.json        # shadcn 配置
  src/
    main.tsx
    router.tsx           # TanStack Router
    lib/
      api.ts             # fetch 封装 + JWT 拦截
      ws.ts              # WebSocket hook（通知 + 聊天）
      query.ts           # TanStack Query client
      utils.ts           # cn() 等
    styles/
      globals.css        # Tailwind v4 + 设计 token
      tokens.css         # 字体/间距/圆角/阴影变量
    components/
      ui/                # shadcn 原子组件（button/input/select/dialog/table/sidebar/breadcrumb/chart/sonner...）
      layout/
        app-sidebar.tsx   # 抄 sidebar-07，可折叠成图标
        site-header.tsx   # SidebarTrigger + 面包屑 + 用户菜单
        sidebar-inset.tsx
      blocks/
        section-cards.tsx  # dashboard KPI 卡
        data-table.tsx    # 通用表格（TanStack Table）
        chart-area.tsx    # recharts 趋势
        login-form.tsx    # 抄 login-03/04
    features/
      auth/              # 登录/注册/微信绑定
      reservation/       # 预约创建/我的预约/日历
      borrow/            # 借还流程/归还上传
      fault/             # 故障报备
      chat/              # 会话列表 + 消息流 + 输入框（WebSocket）
      notification/      # 通知中心
      admin/             # 后台各页
    routes/              # 文件路由
```

### 视觉与字体规范

- 字体栈：`ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`；等宽 `ui-monospace, "JetBrains Mono", monospace`。数字用 `font-variant-numeric: tabular-nums`，统计/表格对齐。
- 圆角：`--radius: 0.625rem`，按钮 `rounded-md`，卡片 `rounded-xl`，输入 `rounded-md`。
- 颜色：HSL token，浅色 `--background` `hsl(0 0% 100%)`、`--card` `hsl(0 0% 100%)`、`--border` `hsl(240 5.9% 90%)`、`--primary` `hsl(222 47% 11%)`；暗色一套。支持 `data-theme="dark"` 切换。
- 间距：基于 `--spacing: 0.25rem`，Grid 用 `gap-4`。

### Input 组件（对齐 Element Plus 能力）

`web/src/components/ui/input.tsx` 基于 shadcn Input 扩展，提供下列 props，覆盖 Element Plus Input 文档的全部用法：

- `clearable`：尾部清除按钮 + `onClear` 事件，图标用 lucide `CircleClose`。
- `type="password"` + `showPassword`：尾部眼睛图标切换 `type`。
- `prefix` / `suffix`：插槽放 lucide 图标（Search/Calendar 等）。
- `prepend` / `append`：复合输入（`.com` / `Http://` / 内嵌 Select）。
- `formatter` + `parser`：受控格式化（金额千分位、手机号分段）。
- `maxlength` + `showWordLimit` + `wordLimitPosition`：`inside`/`outside` 两种字数统计位置。
- `size`：`sm`/`md`/`lg` 对应 height 36/40/44。
- `type="textarea"` + `autosize`：`{ minRows, maxRows }`，基于 `ResizeObserver`。
- `countGraphemes`：用 `Intl.Segmenter` 统计字素。
- 受控 + 非受控双模式，`v-model` 等价为 `value` + `onChange`。

### 页面映射（旧 H5 → 新 React 路由）

| 旧页面 | 新路由 | shadcn 块参考 |
| --- | --- | --- |
| `index.html` 首页/登录 | `/login` | login-03/04 |
| 设备列表 | `/devices` | data-table + 卡片网格 |
| 设备详情 | `/devices/:id` | descriptions + tabs |
| 预约创建 | `/reserve` | form + select + date-picker |
| 我的预约 | `/me/reservations` | data-table |
| 使用日历 | `/calendar` | calendar block + fullcallendar-like |
| 借还/归还 | `/borrow/:id` | form + upload |
| 故障报备 | `/faults/new` | form + upload |
| 聊天/会话 | `/chat`、`/chat/:id` | 自定义会话列表 + 消息流（shadcn scroll-area + input） |
| 后台工作台 | `/admin/dashboard` | dashboard-01 (SectionCards+Chart+Table) |
| 后台设备 | `/admin/devices` | data-table + 抽屉编辑 |
| 后台预约审批 | `/admin/reservations` | data-table + 批次明细 |
| 后台用户 | `/admin/users` | data-table + 详情抽屉 |
| 后台故障 | `/admin/faults` | kanban 风格表格 |
| 后台统计 | `/admin/stats` | chart-area + chart-bar |
| 后台系统配置 | `/admin/system` | form + descriptions |
| 后台操作日志 | `/admin/audit` | data-table |

### 后台布局

- `AppSidebar`（抄 sidebar-07）：可折叠到图标态，分组：工作台 / 设备 / 预约 / 借还 / 故障 / 用户 / 聊天 / 统计 / 系统。底部 `NavUser` 显示当前管理员 + 退出。
- `SiteHeader`：`SidebarTrigger` + 分隔 + `Breadcrumb`（当前页面）+ 右侧通知铃铛（Sonner）+ 主题切换 + 用户头像。
- 主区 `SidebarInset`：SectionCards（KPI 卡：待审预约/在用设备/未处理故障/今日归还）+ ChartAreaInteractive（7 日使用趋势）+ DataTable（最近预约）。
- 移动端：侧边栏抽屉化，`< md` 自动折叠成 `Sheet`。

## 逻辑升级

1. 鉴权：JWT + refresh，前端 `api.ts` 自动续期，401 跳登录。原 token 黑名单迁移为 JWT jti 失效表。
2. 权限：保留 `permissions/roles/role_permissions/user_roles`，后端中间件 `requirePerm('reservation.approve')`，前端 `usePerm()` 控制菜单/按钮显隐。
3. 预约：保留 `reservation_batches + reservation_items` 预检 → 创建 → 审批 → 借出 → 归还闭环；新增"超时未归还自动转 `overdue`"定时任务（`src/tasks/overdue-scheduler.js`）。
4. 归还：归还图上传保留 multer，前端用 shadcn `Upload`（dropzone）+ 预览。
5. 故障：流程 pending → processing → resolved → closed，后台看板化。
6. 导出：`export_jobs` 异步化，前端 `DataTable` 工具栏触发，完成后 WebSocket 推送下载链接。
7. 通知：`user_notifications` + WebSocket，前端中心 = Sonner toast + `/notifications` 列表。
8. 聊天：保留全部会话/消息/已读能力，从 SSE 迁到 WebSocket，前端新增 `/chat` 路由（会话列表 + 消息流 + 输入指示 + 已读回执），实验管理总群作为系统公告入口。
9. 每日日报：保留 `daily-report-scheduler`，时间从 `system_configs` 读取。
10. 微信：公众号回调 + 验证码登录 + 绑定保留；新增 `user_wechat_bindings` 支持 unionid 多公众号。

## 里程碑与验收

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| M0 基建 | `web/` 脚手架、shadcn 初始化、Tailwind token、Vite 构建链入 Express | `npm run dev` 前端跑起，`/` 显示登录页骨架 |
| M1 数据库 | 3.0 迁移 SQL、`scripts/migrate-2-to-3.js`、本地 `npm run db:migrate` | 关键对象存在性检查通过，演示数据可导入 |
| M2 后端骨架 | JWT、`/api/v5` 路由拆分、zod 校验、problem+json、WebSocket 网关（含聊天） | `npm run smoke -- /api/v5`，OpenAPI 雏形 |
| M3 公共前端 | 登录/注册/微信绑定、Layout（Sidebar/Header/Breadcrumb）、Toast、通知中心、聊天会话 | Playwright 登录 + 聊天发消息用例通过 |
| M4 用户端 | 设备列表/详情、预约创建/我的预约、日历、借还归还、故障报备 | 关键用户路径 E2E 通过 |
| M5 后台 | dashboard + 设备/预约/用户/故障/统计/导出/系统/审计 | shadcn dashboard-01 视觉对齐，E2E 通过 |
| M6 可靠性 | Playwright 全量、`doctor`、备份恢复 runbook、VPS 升级脚本更新 | `npm run e2e` 绿，升级文档完整 |

## 回滚与风险

- 全程在 `release/3.0` 长分支开发，`main` 保留 2.x 可发布。
- M1 数据库迁移前必须 `pg_dump` 全量备份；迁移提供 `scripts/rollback-3-to-2.sql`。
- 前端构建产物在 `public/`，若 3.0 出问题可切回 2.x 的 `public/`（git 分支切换）。
- 风险点：JWT 迁移期双 token 共存（保留 `/api` 兼容 2 周）、聊天从 SSE 切 WebSocket 需双开过渡、React 重写工作量集中在 M3-M5。

## 执行记录

### 2026-07-04

- 方案初稿，方向：React + shadcn/ui 一次性大重构。
- 聊天功能确认保留，从 SSE 迁移到 WebSocket，前端新增 `/chat` 路由。
- 已对照 Element Plus Input 文档完整列出交互能力移植清单。
- 已对照 shadcn blocks 选定 dashboard-01 / sidebar-07 / login-03 作为后台与登录骨架。
- **M0 基建完成**：
  - 新建 `web/` 子工程：React 18 + TypeScript + Vite 6 + Tailwind v3 + TanStack Query/Router。
  - 设计 token 落地：HSL 双主题、`--radius 0.625rem`、系统字体栈、`tabular-nums`。
  - UI 原子组件：`Button`（cva 变体）、`Input`（复刻 Element Plus Input 全部能力：clearable/showPassword/prefix/suffix/prepend/append/formatter+parser/maxlength+showWordLimit+wordLimitPosition/size/textarea 待补）、`Card`。
  - 路由骨架：`/login` + `_app` 布局 + `/admin/dashboard` 占位。
  - 登录页：抄 shadcn login-03 结构（居中 card + 顶部 logo）。
  - 后台 Layout：`AppSidebar`（可折叠图标态 + 分组导航）、`SiteHeader`（折叠按钮 + 面包屑 + 通知）、主区 Outlet。
  - Dashboard 占位：4 张 KPI 卡 + 进度卡。
  - Vite 代理 `/api` `/wechat` `/uploads` 到后端 3000；构建产物输出到 `../public/v5/`，`base: '/v5/'`，与 2.x `public/*` 并存互不影响。
  - 根 `.gitignore` 增 `web/node_modules` `web/dist` `public/v5/`。
  - `web/` 用独立 `package.json`，不污染根工程 `package.json`。
  - 验证：`npm run typecheck` 绿；`npm run build` 21s 输出 index.html/css/js/map；根侧 `npm run check` 仍全绿。
- 待 M3：接入真实登录接口、Notification/Toast、聊天会话前端。
- **M2 后端骨架完成**：
  - `src/lib/auth.js`：自实现 HS256 JWT（issueJwt/verifyJwt，access 15min + refresh 7d，jti），中间件 `requireAuth/optionalAuth/requirePerm/requireRole`，与 2.x HMAC token 并存互不干扰。
  - `src/lib/validate.js`：zod 校验（validate/parseBody/parseQuery/parseParams），失败抛 AppError(422, code 2002)。
  - `src/lib/v5-http.js`：成功 `{code:0,data,message}`；错误支持 problem+json（Accept 或 `?problem=1` 触发）与 2.x 风格失败体双形态；`wrapV5` 捕获 handler 异常。
  - `src/lib/ws.js`：WebSocket 网关（`/api/v5/ws`），单连接多频道，自动订阅 `notifications:<sub>`，支持 subscribe/unsubscribe/heartbeat，JWT 鉴权；`broadcast(channel,msg)` 供后端推送。
  - `src/routes/v5/auth.js`：`/auth/login`、`/auth/refresh`、`/auth/logout`、`GET /me`，复用 2.x `adminLogin/loginUser` 做密码校验后签发 JWT 双 token。
  - `src/routes/v5/index.js`：v5 总路由代理层（devices/reservations/borrow/chat/notifications），鉴权用 JWT，业务复用 2.x service；桥接中间件把 JWT 转 2.x token（`service.bridgeLegacyToken`）；末尾错误中间件统一 sendFail。
  - `src/services/create-rental-service.js`：导出 `bridgeLegacyToken(auth)` 把 JWT payload 转 2.x makeToken。
  - `src/app/create-app.js` + `server.js`：挂载 `/api/v5`；server.js 用 `http.createServer` + `createWsGateway(httpServer)` 启用 WebSocket；2.x `/api` 不变。
  - 新增依赖 `zod`、`ws`。
  - 验证：`npm run check` 全绿（68 JS + 7 inline + 无乱码）；`scripts/v5-selftest.js` 真实 HTTP 自测通过：`/devices` 200、`/login` 签发 JWT、`/me` 200、`/me?problem=1` 401 返回 `application/problem+json`。
- 待 M3：前端对接 v3 登录接口、Notification/Toast、聊天会话前端。
- **M1 数据库迁移完成**：
  - `sql/migrations/2026-07-04_v3_foundation.sql`：枚举 CHECK 约束化（7 类状态/角色）、业务表软删除 `deleted_at`、审计字段 `created_by/updated_by`、`device_time_slots.capacity`、`user_notifications.action_url + level`、`chat_conversations.last_message_preview/last_message_type` + 已读游标索引、`audit_logs` 统一审计表、`user_wechat_bindings` 微信独立表、视图加 `deleted_at` 过滤、3.0 配置项与 `chat.use`/`audit.view` 权限。全部 additive + 幂等。
  - `sql/migrations/2026-07-04_v3_foundation_rollback.sql`：逐项 DROP 回滚，视图回退到 2.x 版本。
  - `scripts/migrate-2-to-3.js`：双库迁移工具，支持 `--check/--export/--import`，默认表清单覆盖 19 张主表，upsert by id 幂等导入。
  - `package.json` 新增脚本：`db:migrate-2-to-3`、`:export`、`:import`。
  - 验证：`node scripts/migrate-2-to-3.js --check` 无源库时友好退出；根 `npm run check` 全绿（62 JS + 7 inline + 无乱码）。
- **3.0 视觉与交互层补强**：
  - `public/css/formal.css` 新增 IDBS 3.0 覆盖层：shadcn 风格 neutral 背景、1px 边框、低阴影卡片、紧凑数据表、sticky 表头、柔和 header/sidebar、统一 focus ring 与按钮/Toast/空状态。
  - `public/js/ui.js` 新增 Element Plus Input 风格增强：自动包装输入框、前缀图标、clearable 清空按钮、密码显示/隐藏、动态渲染表单自动增强。
  - 根 `package.json` 新增 `v5:typecheck`、`v5:build`、`v5:selftest`，统一 3.0 验证入口。
  - 验证：`cmd /c npm run v5:typecheck`、`cmd /c npm run v5:build`、`cmd /c npm run v5:selftest`、`cmd /c npm run check` 全部通过。
- **M3 前端数据接入推进**：
  - `/api/v5/admin/dashboard`、`/api/v5/admin/reservation-batches`、`/api/v5/admin/reservation-batches/:id`、批次/明细审批接口已接入 v3 router，统一 JWT 鉴权 + permission 中间件。
  - `web/src/features/dashboard/dashboard-placeholder.tsx` 从占位升级为真实 dashboard：KPI、设备状态、今日运行指标全部从 v5 API 读取，保留 shadcn section card 布局。
  - `web/src/features/admin/admin-pages.tsx` 新增后台设备、预约和模块页；`web/src/routes.tsx` 补齐侧栏对应路由，避免 3.0 后台导航断链。
  - `scripts/v5-selftest.js` 增加 `/api/v5/admin/dashboard` 覆盖。
  - 验证：`cmd /c npm run v5:selftest`、`cmd /c npm run v5:build`、`cmd /c npm run check` 全部通过。
- **A/B/C 合并升级推进**：
  - A 审计：确认 `web/src/features` 中设备、预约、日历等用户端页面仍有 mock/占位数据，v5 API 已具备对应设备、预约、日历与后台预约批次基础能力。
  - B 用户端闭环：`/devices`、`/devices/:code` 从 mock 改为读取 `/api/v5/devices` 与 `/api/v5/devices/:code`；`/reserve` 接入预约预检与创建；`/me/reservations` 接入我的预约；`/calendar` 接入日历日视图。
  - C 后台闭环：预约批次接口保持接入，`scripts/v5-selftest.js` 扩展覆盖设备列表/详情、预约预检/创建/我的预约、日历日视图、后台预约批次。
  - 验证：`cmd /c npm run v5:typecheck && npm run v5:build && npm run v5:selftest && npm run check` 通过；Vite 仅提示 chunk 大小警告，不影响构建产物。
- **第二轮 3.0 用户端闭环优化**：
  - 借还页从说明占位升级为真实表单：支持按预约明细 ID 或设备编号调用 `/api/v5/borrow-records` 开始使用，并可按借用记录 ID 调用 `/api/v5/borrow-records/:id/return` 提交归还。
  - 故障页从说明占位升级为真实表单：支持设备编号/借用记录 ID、故障类型、描述，调用 `/api/v5/fault-reports` 提交报备。
  - 通知与聊天 API 兼容 v5 标准包裹响应：`notifications/conversations/messages` 同时支持数组直返和 `{notifications|conversations|messages}` 包裹结构。
  - `scripts/v5-selftest.js` 扩展覆盖借用、归还、故障、通知读取/已读、聊天会话/消息/发送等接口。
  - 验证：`cmd /c npm run v5:typecheck && npm run v5:build && npm run v5:selftest && npm run check` 通过；Vite chunk 体积提示仍为后续性能优化项。
- **第三轮 3.0 后台可靠性优化**：
  - 后台 Dashboard、用户管理、故障处理、统计分析、导出任务、操作审计补充接口错误态展示，避免接口失败时只显示空列表或静默失败。
  - 统计分析页同时处理总览与设备排行两个异步请求的错误态，提升后台排障可见性。
  - 用户、故障、导出、审计表格统一补充 `text-destructive` 错误提示，与现有 loading/empty 态形成完整三态反馈。
  - 验证：`cmd /c npm run v5:typecheck && npm run v5:build && npm run v5:selftest && npm run check` 通过；Vite chunk 体积提示仍为后续性能优化项。
- **第四轮 3.0 构建性能优化**：
  - `web/vite.config.ts` 增加 Rollup `manualChunks`，将图表相关 `recharts/d3-*` 拆分到独立 `vendor-charts`，其他第三方依赖进入 `vendor`。
  - 目标是降低单入口 JS chunk 体积，消除 500KB 以上 chunk 警告，并提升浏览器长期缓存命中率；避免过细 vendor 拆分造成循环 chunk 警告。
  - 验证：`cmd /c npm run v5:typecheck && npm run v5:build && npm run v5:selftest && npm run check` 通过；构建输出最大 chunk 为 `vendor` 约 399.72KB、`vendor-charts` 约 347.08KB，已低于 500KB 警告阈值且无循环 chunk 警告。
- **第五轮 Element Plus Overview 风格适配（旧版后台）**：
  - 基于 `http://127.0.0.1:3000/admin.html#overview` 旧版后台总览，在不引入 Vue/Element Plus 依赖的前提下，选取适合 IDBS 的组件模式：Alert、Skeleton、Statistic、Progress、Descriptions。
  - `public/js/admin-workbench.js`：总览加载改为骨架屏；新增运营健康度评分、进度条、部分接口失败 Alert、运营摘要 Descriptions；KPI 卡加入轻量图标语义。
  - `public/css/formal.css`：新增 Element Plus inspired 的总览 hero、health progress、alert、stat card、descriptions、skeleton 响应式样式。
