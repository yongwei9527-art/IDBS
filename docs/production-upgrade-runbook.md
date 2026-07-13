# IDBS 2.0 生产升级与回滚手册

更新时间：2026-07-03

本文档用于 VPS/生产环境升级。IDBS 2.0 不兼容旧数据库结构，升级前必须完成数据库和上传文件备份。

## 1. 升级前检查

- 确认当前代码已通过：`npm run check`。
- 确认测试环境已通过：`npm run smoke`。
- 确认测试环境已通过 Playwright E2E；本地可使用独立端口并设置 `API_RATE_LIMIT_MAX=1000` 避免批量资源请求触发限流。
- 确认 `.env` 中 `DATABASE_URL`、`TOKEN_SECRET`、`ADMIN_PASSWORD`、微信配置均为生产值。
- 确认有足够磁盘空间保存数据库备份和 `uploads/` 备份。
- 确认维护窗口，升级期间停止对外使用。

## 2. 备份

建议备份目录：`/var/www/idbs/backups/YYYYMMDD-HHMMSS/`。

必须备份：

1. PostgreSQL 数据库：使用 `pg_dump` 导出完整数据库。
2. `uploads/`：保留用户上传图片和附件。
3. 当前代码版本：记录 Git commit 或打包当前目录。
4. 当前 `.env`：仅保存在服务器安全目录，不提交到仓库。

备份完成后，需要确认备份文件大小非 0，并至少抽查一次恢复命令可读取。

## 3. 升级步骤

1. 停止服务。
2. 再次确认备份存在。
3. 拉取或上传 IDBS 2.0 新代码。
4. 安装依赖。
5. 全量重建数据库基线或执行升级迁移：
   - 本地/测试库：`RESET_IDBS_SCHEMA=1 npm run db:reset-schema`
   - 非本地库：`RESET_IDBS_SCHEMA=1 ALLOW_PRODUCTION_SCHEMA_RESET=1 npm run db:reset-schema`
   - 保留数据升级：用 PostgreSQL 表 owner/admin 执行 `npm run db:upgrade-schema` 输出的全部手动 SQL。
   - 若 `npm run doctor` 仍报告 `users.*`、`operation_logs.*`、`borrow_records.*`、`reservation_batches.*` 或 `usage_log.reservation_item_id` 缺失，说明当前迁移账号不是表 owner，不能进入上线步骤。
6. 初始化管理员、系统配置和演示/必要业务数据。
7. 启动服务。
8. 运行：`npm run doctor`。
9. 运行：`npm run smoke`。
10. 运行：`npm run e2e`。
11. 人工验收：登录、注册审核、创建设备、提交预约、审批、开始使用、归还、故障、聊天、导出。

## 4. 验收清单

- `/health` 正常。
- `/ready` 正常。
- 管理员可登录。
- 用户可注册、审核、登录。
- 可新增设备。
- 可提交多设备、多日期、多时间段预约。
- 后台可整批审批和单条审批。
- 用户可开始使用、归还设备、报备故障。
- 日历显示预约明细。
- 统计导出可下载，导出队列可创建任务，`npm run exports:run` 可生成导出文件。
- `npm run check`、`npm run doctor`、`npm run smoke`、`npm run e2e` 通过。
- 预约事实源检查：新预约写入 `reservation_batches` 和 `reservation_items`；借还、故障、通知、日历和设备下一预约读取 `reservation_items`。
- 旧 `reservations` 仅保留兼容/回填用途，不作为新业务事实源。

## 5. 回滚策略

如升级失败，按以下顺序回滚：

1. 停止新服务。
2. 代码回滚到升级前版本。
3. 删除或重建当前数据库。
4. 使用升级前 `pg_dump` 恢复数据库。
5. 恢复 `uploads/` 目录。
6. 恢复升级前 `.env`。
7. 启动旧服务。
8. 验证 `/health`、登录、设备列表和核心预约流程。

## 6. 失败处理原则

- 数据库重建失败：不要继续启动生产服务，先恢复备份。
- doctor 失败：按失败项修复后重新运行，不跳过。
- smoke 失败：保留日志，先判断是否影响核心流程；影响核心流程必须回滚。
- 微信推送失败：不阻塞主系统上线，但必须记录配置和失败日志。
- 导出任务失败：不阻塞预约主流程，可查看 `export_jobs.error_message`，也可降级使用同步 CSV/Excel 导出。

## 7. VPS 管理员密码重置

一键安装/更新脚本会在 VPS 写入以下运维命令：

```bash
sudo idbs-reset-admin-password
```

该命令会读取 `/var/www/idbs/shared/.env` 中的生产数据库连接，交互式输入两次新后台管理员密码，并更新数据库里的 `admin_password_salt` 与 `admin_password_hash`。输入密码时终端不会回显。

非交互自动化场景可使用：

```bash
sudo ADMIN_NEW_PASSWORD='新的强密码至少8位' idbs-reset-admin-password
```

## 8. 上线后观察

上线后至少观察 24 小时：

- Node 服务日志。
- PostgreSQL 连接数和慢查询。
- 上传目录写入权限。
- 预约冲突错误是否异常增加。
- 聊天 SSE 是否频繁断线。
- 微信推送失败日志。
- 导出任务数量、状态和 `/uploads/exports/` 文件增长情况。

## 9. IDBS 3.0 扩展部署

IDBS 3.0 与 2.x 并行运行，2.x 页面仍走 `/`，3.0 前端构建产物位于 `public/v5/`，API 统一挂到 `/api/v5`。升级为增量迁移，2.x 数据库结构保留并加新增表与字段。

### 9.1 3.0 迁移

1. 应用迁移 SQL（PostgreSQL 超级用户或表 owner 执行）：
   ```bash
   psql "$DATABASE_URL" -f sql/migrations/2026-07-04_v5_foundation.sql
   ```
2. 若从已有 2.x 数据迁移到独立测试库：
   ```bash
   npm run migrate-2-to-3 -- --check      # 仅检查
   npm run migrate-2-to-3 -- --export     # 导出
   npm run migrate-2-to-3 -- --import     # 导入
   ```
3. 重新运行校验：
   ```bash
   npm run doctor    # 若 v5 项仍_warn_，说明迁移未执行成功
   npm run check
   node scripts/v5-selftest.js   # v5 路由自测
   ```

### 9.2 前端构建

```bash
cd web
npm install
npm run build      # 产物输出到 ../public/v5/
```

- Vite `base: '/v5/'`，访问入口 `https://your-host/v5/`。
- 开发：`npm run dev`（Vite 代理 `/api`、`/wechat`、`/uploads` 到端口 3000）。

### 9.3 鉴权与兼容

- 3.0 使用自实现 HS256 JWT（`src/lib/auth.js`），`TOKEN_SECRET` 与 2.x 共享。
- 2.x 业务服务通过 `bridgeLegacyToken` 将 v5 JWT 转成 2.x HMAC token，迁移期间受限重用旧服务，最后分阶段替换。

### 9.4 验收（3.0 专属）

- `/api/v5/auth/login` 返回 access/refresh token。
- 401 自动 refresh 多一次成功，且 localStorage 中 `idbs.access_token` 被刷新。
- `/v5/` 后台总览、设备、用户、故障、预约、统计、导出、系统、审计页面正常加载与操作。
- WebSocket 连接 `/api/v5/ws` 握手成功，聊天实时推送。
- 2.x 页面 `/` 不受影响。

### 9.5 回滚（3.0 专属）

- 仅停止 3.0 前端服务并删除 `public/v5/`。
- v5 数据库迁移为添加项（无破坏性列修改），无需回滚 SQL；如需彻底清理，反向执行 `sql/migrations/2026-07-04_v5_foundation.sql` 同目录下的 rollback SQL。
- 2.x 服务与页面立即恢复。
