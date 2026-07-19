# IDBS 5.0 生产安全与备份检查清单

面向实验室部署：在内网或公网发布前，按本清单逐项确认。  
目标：权限可用、数据可恢复、基础滥用可挡、公网风险可控。

---

## 一、密钥与环境（必须）

| 项 | 要求 | 推荐值/动作 |
|----|------|-------------|
| `NODE_ENV` | 生产必须为 production | `production` |
| `ADMIN_PASSWORD` | ≥12 位，非占位符 | 随机长密码；禁止 123456/admin |
| `TOKEN_SECRET` | 足够随机，非占位符 | ≥32 字节随机串 |
| `DATABASE_URL` | 最小权限账号 | 勿用超级用户跑业务 |
| `CORS_ORIGIN` | 明确域名，勿用 `*` | `https://lab.example.com` |
| `TRUST_PROXY` | 反代后开启 | Nginx 后设 `true` |
| `ENABLE_SCHEDULERS` | 生产保持开启 | `true` |
| 演示账号 | 生产关闭或改密 | 删除 seed 弱口令账号 |

自检：

```bash
npm run doctor
```

生产环境下弱密钥会导致进程拒绝启动（`buildRuntimeStatus`）。

---

## 二、限流与应用层防护（必须）

| 项 | 默认 | 生产建议 |
|----|------|----------|
| 登录限流 | 10 次 / 10 分钟（IP+账号） | 保持或更严：`AUTH_RATE_LIMIT_MAX=5` |
| API 总限流 | 120 次 / 分钟 | 视并发：`API_RATE_LIMIT_MAX=60~180` |
| 请求体 | JSON 2MB | 反代再限 20m 以内 |
| 密码注册 | 已关闭 | 保持关闭，仅微信验证码绑定 |
| 验证码小时上限 | 3 | 生产保持 ≤5 |
| OpenID 日绑定 | 1 | 生产保持 1 |
| 禁止裸 IP 访问 | 默认关 | 生产开启系统配置 `block_ip_access_enabled` |
| 图像验证码 | 默认关 | 暴露公网时建议开启 |

相关代码：

- `src/lib/security.js` 限流
- `src/app/create-app.js` 登录/API 限流与安全头
- 系统配置：`captcha_hourly_limit` / `openid_daily_register_limit` / `block_ip_access_enabled`

---

## 三、反向代理与网络（公网强烈建议）

使用仓库模板：`deploy/nginx.idbs.conf`（已含基础限流与安全头建议）。

最低要求：

1. **只暴露 80/443**，Node 只监听 127.0.0.1:3000  
2. **TLS 证书**（Let’s Encrypt 等）  
3. `client_max_body_size 20m;`  
4. 传递 `X-Forwarded-For` / `X-Forwarded-Proto`  
5. WebSocket：`/api/v5/ws`  
6. **不要**把 `/uploads/exports` 直接静态公开（导出走鉴权接口）  
7. 云厂商安全组：仅 22（管理网段）、80/443  

防 DDoS 说明：

- 应用层限流 **不能**替代云防护 / WAF / 带宽清洗  
- 公网务必配合：云防火墙、WAF、连接限制、必要时 CDN  

---

## 四、数据库定期完整备份（必须）

### 命令

```bash
# 立即全库备份 + 校验
npm run db:backup

# 仅校验最近一份
npm run db:backup:verify

# Linux 安装每日 02:15 定时任务
bash scripts/install-backup-schedule.sh
```

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-database.ps1
```

可用任务计划程序每日 02:15 调用上述脚本。

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `BACKUP_DIR` | `backups/db` | 备份目录 |
| `BACKUP_RETENTION_DAYS` | `14` | 保留天数 |
| `BACKUP_FORMAT` | `custom` | `custom`(`.dump`) 或 `plain`(`.sql`) |
| `PG_DUMP_PATH` | 自动探测 | pg_dump 绝对路径 |

### 恢复（演练）

```bash
# custom 格式
pg_restore --clean --if-exists --no-owner --no-acl -d "$DATABASE_URL" backups/db/idbs-YYYYMMDDTHHMMSSZ.dump

# plain SQL
psql "$DATABASE_URL" -f backups/db/idbs-YYYYMMDDTHHMMSSZ.sql
```

**每季度至少做一次恢复演练**，确认备份可用，不只“看起来生成了文件”。

### 生产附加建议

1. 备份目录挂到独立磁盘  
2. 每天同步一份到另一台机器/对象存储  
3. 备份失败写日志并告警（邮件/企业微信）  
4. PostgreSQL 如有条件，再加 WAL 基础备份做 PITR  

---

## 五、权限与模块化抽查

```bash
npm run v5:permission-audit
npm run doctor
```

检查：

- 非超管角色菜单是否按 `ADMIN_MODULES` 隐藏  
- 接口是否仍返回 403（不能只靠前端藏按钮）  
- 操作审计页能否看到关键动作  

权限源：`src/modules/lab-modules.js`  
前端注册表：`web/src/features/platform/operations-module-registry.ts`

---

## 六、上线前 15 分钟清单

- [ ] `NODE_ENV=production`  
- [ ] 强 `ADMIN_PASSWORD` / `TOKEN_SECRET`  
- [ ] `CORS_ORIGIN` 为正式 HTTPS 域名  
- [ ] `TRUST_PROXY=true`（有 Nginx）  
- [ ] 完成 `npm run db:migrate`  
- [ ] `npm run doctor` 无 FAIL  
- [ ] `npm run db:backup` 成功且 `db:backup:verify` 通过  
- [ ] 已安装定时备份（cron / 任务计划）  
- [ ] Nginx 只反代本机 3000，限制体大小  
- [ ] 系统配置：按需开启禁止裸 IP、验证码  
- [ ] 演示弱口令账号已清理  
- [ ] 手动登录 + 预约 + 导出抽测通过  

---

## 七、能力边界（避免误判）

| 能力 | 状态 |
|------|------|
| 业务模块化 / 管理员权限 | 已具备 |
| 登录与 API 限流 | 已具备 |
| 关密码注册 + 微信绑定频控 | 已具备 |
| 每日全库备份 + 保留 + 校验 | 本方案补齐 |
| 公网抗大规模 DDoS | **依赖云/机房，不在 Node 内完成** |
| 企业级风控/设备指纹 | 未做，实验室场景通常非必须 |

---

## 八、相关文件

- `scripts/backup-database.js`  
- `scripts/backup-database.sh`  
- `scripts/backup-database.ps1`  
- `scripts/install-backup-schedule.sh`  
- `deploy/nginx.idbs.conf`  
- `.env.example`  
- `docs/production-security-checklist.md`（本文）
