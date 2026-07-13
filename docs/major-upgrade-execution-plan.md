# IDBS 大升级执行方案

> **Historical record.** Current IDBS 5.0 release material is [v5-release.md](./v5-release.md) and [v5-api-contract.md](./v5-api-contract.md).

更新时间：2026-07-03

本文档用于把“大升级”拆成可执行、可检查、可回滚的阶段。原则是：整体规划、分批落地；每一批完成后必须能启动、能检查、核心流程不被破坏。

## 1. 升级总原则

- 不一次性重写所有模块。
- 只保留 REST API；旧版 `POST /api/:action` 已删除。
- 数据库变更必须通过 `sql/migrations/` 落地，不能只改 `schema.sql`。
- 每个阶段结束必须执行 `npm run check`；涉及接口和业务流程时执行 `npm run smoke`。
- 前端隐藏权限只作为体验优化，最终权限必须由后端接口校验。
- 生产升级前必须备份 PostgreSQL 数据库和 `uploads/` 目录。

## 2. 阶段总览

| 阶段 | 名称 | 目标 | 主要风险 |
| --- | --- | --- | --- |
| 第 1 阶段 | 服务层拆分准备 | 降低 `create-rental-service.js` 继续膨胀风险 | 引用关系复杂 |
| 第 2 阶段 | 数据库与迁移增强 | 支持长期扩展、巡检和统计 | 新基线初始化 |
| 第 3 阶段 | API 契约升级 | REST 接口清晰、旧 action 删除 | 前后端字段不一致 |
| 第 4 阶段 | 后台升级 | 提升审批、设备、统计、权限管理体验 | `admin.js` 体积大 |
| 第 5 阶段 | 用户端升级 | 优化预约、日历、我的记录、设备详情 | 预约流程易受影响 |
| 第 6 阶段 | 部署与生产安全 | 提升上线稳定性和巡检能力 | VPS 环境差异 |

## 3. 第 1 阶段：服务层拆分准备

### 3.1 目标

当前 `src/services/create-rental-service.js` 同时包含认证、用户、设备、预约、聊天、后台、报表、微信等逻辑。第一阶段不直接大规模移动代码，而是先建立“服务上下文 + 分域目录 + 可迁移边界”，确保后续能逐步拆分。

### 3.2 执行内容

1. 新建服务分域目录：
   - `src/services/core/`
   - `src/services/domains/auth/`
   - `src/services/domains/users/`
   - `src/services/domains/devices/`
   - `src/services/domains/reservations/`
   - `src/services/domains/admin/`
   - `src/services/domains/chat/`
   - `src/services/domains/reports/`
   - `src/services/domains/wechat/`
2. 抽出低风险纯工具：
   - 文本校验
   - 布尔解析
   - 日期格式化
   - token 编解码辅助的外壳
3. 保持 `createRentalService()` 的导出形状不变。
4. 不改变任何路由路径和返回结构。

### 3.3 验收标准

- `npm run check` 通过。
- `src/routes/rest-api.js` 不需要因为拆分改变路由调用方式。
- `createRentalService()` 仍返回现有方法。
- 登录、设备列表、预约、后台登录基础流程不变。

## 4. 第 2 阶段：数据库与迁移增强

### 4.1 目标

补齐长期维护需要的基础表和巡检能力，避免未来只靠业务表推断状态。

### 4.2 执行内容

1. 增加迁移状态/版本检查说明。
2. 强化关键索引：预约、借还、聊天、通知、操作日志。
3. 为统计和日历视图补充标准查询。
4. 增加生产巡检 SQL 清单。

### 4.3 验收标准

- 新增迁移脚本可重复执行或具备 `IF NOT EXISTS` 保护。
- 本地迁移后 `/ready` 正常。
- `npm run smoke` 通过。

## 5. 第 3 阶段：API 契约升级

### 5.1 目标

把全部前端和外部调用收敛到 REST API，删除旧版 action 接口。

### 5.2 执行内容

1. 更新 `docs/api-contract.md`。
2. 为新增/调整接口补充入参、出参和错误码。
3. 后端新增接口先写在 `src/routes/rest-api.js`。
4. 不再新增或保留 `legacyRoutes`。

### 5.3 验收标准

- 所有新增接口在文档中可查。
- 所有页面均通过 REST API 工作。
- 认证失败统一返回 `1001`，权限失败统一返回 `1003`。

## 6. 第 4 阶段：后台升级

### 6.1 目标

后台从“功能堆叠”升级为“工作台驱动”：先看到待处理事项，再进入具体模块。

### 6.2 执行内容

1. 优化后台工作台指标。
2. 设备管理支持更明确的状态流转。
3. 预约审批支持批次、明细、冲突原因、历史筛选。
4. 用户审核支持详情、禁用、解绑、角色授权。
5. 统计导出增加清晰字段说明。

### 6.3 验收标准

- 普通管理员只能看到/操作有权限的模块。
- 超级管理员能管理角色和权限。
- 后台主要 tab 不出现未捕获前端异常。

## 7. 第 5 阶段：用户端升级

### 7.1 目标

让用户预约流程更清楚，减少手填和误提交。

### 7.2 执行内容

1. 设备列表增强筛选、状态、今日可用时间段。
2. 设备详情增强近 14 天占用、说明、故障摘要。
3. 预约页支持多计划预览、冲突检查、清晰提交结果。
4. 日历页固定完整月份视图。
5. 我的记录整合待审核、已通过、使用中、已完成、异常。

### 7.3 验收标准

- 未登录访问业务页会跳转登录。
- 用户可完成预约预检、提交、查看记录。
- 日历在无预约时也正常显示完整月份。

## 8. 第 6 阶段：部署与生产安全

### 8.1 目标

降低 VPS 上线和后续维护风险。

### 8.2 执行内容

1. 增加生产巡检脚本或增强 `scripts/doctor.js`。
2. 检查 `.env` 默认值、弱密钥、上传目录权限。
3. 检查 Nginx 默认站点、反向代理、静态资源。
4. 增加备份/恢复演练文档。

### 8.3 验收标准

- `/health` 和 `/ready` 正常。
- `npm run check` 和 `npm run smoke -- http://127.0.0.1:3000` 通过。
- 生产 `.env` 无默认密钥和弱密码。

## 9. 每阶段交付清单

每个阶段结束时都要记录：

- 修改文件列表。
- 新增/调整 API。
- 新增/调整数据库对象。
- 手动验证结果。
- 自动检查结果。
- 已知遗留问题。
- 是否可进入下一阶段。

## 10. 当前立即执行顺序

本次先从第 1 阶段开始：

1. 建立服务拆分目录和说明文件。
2. 抽出低风险公共工具。
3. 保持现有业务行为不变。
4. 执行 `npm run check`。
5. 通过后再继续拆分认证、设备、预约等领域逻辑。

## 11. 阶段执行记录

### 2026-07-03：第 1 阶段启动

- 已建立服务拆分目录：`src/services/core/` 与 `src/services/domains/*/`。
- 已新增各领域 README，明确认证、用户、设备、预约、后台、聊天、报表和微信的拆分边界。
- 已抽出低风险公共工具：`src/services/core/service-utils.js`。
- 已抽出通用校验工具：`src/services/core/validation.js`。
- 已抽出认证基础加密工具：`src/services/core/crypto-utils.js`。
- `createRentalService()` 对外方法保持不变。
- 已执行 `cmd /c npm run check`，结果通过。

下一步继续在第 1 阶段内推进：优先拆分纯函数和只读查询，避免一次性移动预约、聊天 SSE 和审批事务逻辑。

### 2026-07-03：IDBS 2.0 预约核心推进

- 旧 action API 已删除。
- 预约批次和单条审批已改为基于 `reservation_items`。
- 用户“我的记录”已展示预约明细。
- 开始使用、归还、故障报备已写入并更新 `reservation_item_id`。
- 前端增加按钮处理中状态，减少重复点击。
- 聊天和用户相关模块已按 2.0 基线表结构运行。
- 服务层旧库探测函数已删除。

### 2026-07-03：导出与生产可靠性推进

- 已确认依赖处于最新可用状态，`npm outdated` 无输出。
- 已新增 `export_jobs` 数据库基线表，预留大数据异步导出中心。
- 已新增导出任务接口：`GET /api/admin/export-jobs`、`POST /api/admin/export-jobs`、`POST /api/admin/export-jobs/run-next`。
- 后台统计页已增加“加入导出队列”、任务列表、手动处理下一条任务和下载入口。
- 已新增 `npm run exports:run`，用于命令行批量处理待导出任务。
- `scripts/doctor.js` 已纳入 `export_jobs` 表和关键字段检查。
- 已新增 `docs/production-upgrade-runbook.md`，覆盖生产升级、验收、回滚和上线后观察。

### 2026-07-03：服务层继续拆分

- 已新增 `src/services/domains/reports/export-service.js`。
- 导出任务创建、列表、CSV 文件生成和待处理任务执行已从 `create-rental-service.js` 移入报表领域服务。
- `createRentalService()` 的对外方法保持不变，路由层不需要调整。

### 2026-07-03：服务层设备与工作台拆分

- 已新增 `src/services/domains/reservations/reservation-read-service.js`。
- 日历事件、日历单日视图、用户预约批次查询和后台预约批次只读查询已从 `create-rental-service.js` 迁入预约领域服务。
- 已新增 `src/services/domains/reservations/reservation-action-service.js`。
- 预约预检、创建、用户取消、预约明细取消桥接、后台单条/批次审批已从 `create-rental-service.js` 迁入预约事务服务。
- 已新增 `src/services/domains/reservations/borrow-return-service.js`。
- 借用开始、归还提交、异常归还设备状态流转和使用日志写入已从 `create-rental-service.js` 迁入借还服务。
- 预约底层解析辅助、通知辅助和使用日志辅助暂留主服务，后续继续按风险拆分。

- 已新增 `src/services/domains/devices/device-read-service.js`。
- 设备列表、设备详情、预约时间段查询已从 `create-rental-service.js` 移入设备只读服务。
- 已新增 `src/services/domains/devices/device-admin-service.js`。
- 设备新增、更新、后台设备详情和恢复可用已移入设备管理服务。
- 已新增 `src/services/domains/admin/dashboard-service.js`。
- 后台工作台 KPI、待办和设备状态统计已移入后台工作台服务。
- 已执行 `npm.cmd run check`，结果通过。

### 2026-07-03：认证服务拆分

- 已新增 `src/services/domains/auth/auth-service.js`。
- 管理员密码登录、普通用户密码登录和普通密码注册关闭响应已从 `create-rental-service.js` 移入认证领域服务。
- 微信验证码、首次绑定和共享鉴权守卫暂留主服务，避免一次性移动登录挑战状态和跨领域权限依赖。
- 已执行 `npm.cmd run check`，结果通过。

### 2026-07-03：后台系统与用户服务拆分

- 已新增 `src/services/domains/admin/system-service.js`。
- 安全配置、系统选项、权限选项、角色授权、用户角色查询和操作日志已从 `create-rental-service.js` 移入后台系统服务。
- 已新增 `src/services/domains/users/user-service.js`。
- 用户资料、用户通知、后台用户详情/列表、账号删除/禁用、状态调整、封禁和微信解绑已移入用户领域服务。
- 用户诉求、活动摘要、微信绑定和登录挑战流程暂留主服务，避免跨聊天、微信和通知流程一次性移动。