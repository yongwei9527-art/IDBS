# 变更记录

## 5.0.1 - 2026-07-19

本版本在 5.0.0 基础上继续完善稳定性、运维能力与前后端可维护性，详情见 [2026-07 优化说明](./docs/optimization-2026-07.md)。

### 正确性 / 运维
- 修复聊天演示数据种子参数与 `expires_at` 占位符不一致问题。
- SPA `/v5` 静态资源缓存策略：`index.html` 不缓存，带 hash 资源长缓存。
- 新增数据库备份脚本与定时安装入口（`npm run db:backup` / `db:backup:verify` / `db:backup:install-cron`）。
- 新增上传孤儿文件清理脚本（`npm run uploads:cleanup`，默认 dry-run）。
- doctor 增强：检查 `public/v5` 构建产物与 PostgreSQL statement timeout 配置。
- 补充聊天临时会话 TTL 调度与对应数据库迁移。

### 安全 / 性能
- 密码哈希改为异步 `scrypt`，保留 legacy SHA-256 校验与登录后 rehash。
- 登录失败、封禁、未激活写入 `user_activity_logs`（`login_failed` / `login_denied`）。
- 数据库连接支持 `PG_STATEMENT_TIMEOUT_MS` 与 `PG_SLOW_QUERY_MS` 慢查询日志。
- 补充生产安全检查清单文档。

### 结构重构
- 抽出 `reservation-slot-utils`，拆分 `src/routes/v5/*` 域路由（devices / reservations / borrow / chat / admin 等）。
- 前端补充路径常量、系统配置常量，以及 operations API 按域 re-export。
- 界面视觉体系与日夜主题可读性继续优化（布局、系统配置、运营看板、用户请求等页面）。

### 工程化 / 质量
- 前端增加 ESLint / Prettier 配置与 `lint:web` 脚本。
- 新增 `npm run dev:all` 同时启动 API 与 Vite。
- 补充单元测试（slot utils、权限矩阵、SPA 缓存、异步 scrypt 等）与 E2E 回归用例。
- 清理本地临时日志/运行时目录的 `.gitignore` 规则。

### 数据库迁移
- `2026-07-13_priority_usage_archive.sql`
- `2026-07-13_return_material_supplement.sql`
- `2026-07-13_v5_status_constraint_alignment.sql`
- `2026-07-17_chat_temp_direct_ttl.sql`
- `2026-07-17_chat_temp_group_ttl.sql`

## 5.0.0 - 2026-07-11

- 统一产品、根包和 React 前端版本为 5.0.0，同时保留 `/v5/`、`/api/v5` 稳定兼容路径。
- 密码哈希升级为 scrypt；旧 SHA-256 哈希在成功登录后自动迁移，并移除历史默认管理员口令种子。
- refresh token 改为 HttpOnly Cookie 和数据库会话，支持轮换、撤销与重放拒绝。
- WebSocket 改为首帧鉴权、会话成员频道授权、断线重订阅和 Nginx Upgrade 代理。
- PostgreSQL `LISTEN/NOTIFY`、共享限流桶和调度任务认领增强多实例一致性。
- 智能运营查询并行化并明确标注可解释规则引擎 5.0.0。
- 前端路由懒加载，生产 sourcemap 默认关闭，首屏不再预加载图表包。
- 新增 5.0 数据库基础迁移、生产启动门禁、单元测试和 PostgreSQL CI 集成验收。
- 数据库迁移执行器、Ubuntu 部署脚本和 Windows 初始化脚本默认排除所有 `rollback` 文件，防止正向升级误执行回滚。
- CSP 使用当前静态页面内联脚本的 SHA-256 白名单，兼顾旧版应急入口与脚本注入防护。
- 日报调度支持失败后重试、陈旧运行任务接管、10 分钟容错窗口以及跨午夜正确归属，避免短暂故障导致整日漏发。

兼容性、部署、验收和回滚要求见 [5.0 发布说明](./docs/v5-release.md)。
