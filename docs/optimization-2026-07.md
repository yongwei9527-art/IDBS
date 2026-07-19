# IDBS 5.0 优化落地说明（2026-07）

## 已完成

### P0 正确性 / 运维
- 修复 `seedChatDemo` 参数与 `expires_at` 占位符不一致
- SPA `/v5` 静态资源：`index.html` no-cache；带 hash 资源 long-cache
- 清理本地临时日志规则（`.gitignore`）

### 安全 / 性能
- 密码哈希改为异步 `scrypt`（保留 legacy SHA-256 校验与 rehash）
- 登录失败 / 封禁 / 未激活写入 `user_activity_logs`（`login_failed` / `login_denied`）
- DB：`PG_STATEMENT_TIMEOUT_MS` + `PG_SLOW_QUERY_MS` 慢查询日志
- 上传孤儿清理脚本：`npm run uploads:cleanup`（默认 dry-run）

### 结构
- 抽出 `src/services/core/reservation-slot-utils.js`
- 拆分 `src/routes/v5/*` 域路由（devices/reservations/borrow/chat/admin...）
- 前端路径常量 `web/src/lib/app-paths.ts`
- 系统配置页常量抽出 `system-config-constants.ts`
- operations-api 按域 re-export（users/devices/analytics）

### 工程化
- ESLint/Prettier 配置与 scripts（需本机 `npm --prefix web install` 安装依赖）
- `npm run dev:all` 同时起 API + Vite
- doctor 增加 `public/v5` 构建存在性与 statement timeout 检查
- 单测：slot utils、权限矩阵、SPA cache/seed、异步 scrypt
- E2E：`tests/e2e/qa-bug-regressions.spec.js`（BUG-001/004/006）

## 验证
```bash
node scripts/run-unit-tests.js
# 56/56 pass

# 前端类型检查
node web/node_modules/typescript/bin/tsc -p web/tsconfig.json --noEmit
```

## 本机后续一步
因环境限制未能在此自动安装 ESLint 依赖，请在项目根执行：

```bash
npm --prefix web install
npm --prefix web run lint
```
