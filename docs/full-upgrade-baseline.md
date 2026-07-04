# IDBS 全量升级基线

更新时间：2026-07-03

本轮升级策略改为“新版本基线重建”，不再兼容旧数据库结构。旧库只作为备份和必要数据迁移来源；运行态数据库必须以 `sql/schema.sql` 为准。

## 升级原则

- 不再为了旧表、旧字段和旧约束保留兼容判断。
- `sql/schema.sql` 是新安装和全量升级后的唯一目标结构。
- `sql/migrations/` 只用于记录历史增量和必要的开发期演进，不再作为旧生产库的兼容补丁集合。
- 生产升级必须先备份 PostgreSQL 数据库和 `uploads/` 目录。
- 全量升级后再导入必要业务数据；无法映射到新模型的数据不强行保留。

## 推荐执行顺序

1. 备份旧数据库和上传文件。
2. 停止 IDBS 服务，避免升级期间继续写入。
3. 在本地或临时库验证 `sql/schema.sql` 可以完整初始化。
4. 使用 `npm run db:reset-schema` 重建目标数据库结构。
5. 初始化管理员、系统配置和必要演示/基础数据。
6. 启动服务，执行 `npm run check` 和 `npm run smoke`。
7. 完成人工 UAT：登录、预约、审批、借还、归还、故障、聊天、导出。

## 巡检要求

IDBS 2.0 不再把缺失的升级表或字段视为可兼容状态。`npm run doctor` 会把缺少核心表、核心字段、核心视图或预约排他约束判定为失败。

如果巡检失败，请先确认已备份数据，再使用全量基线重建命令。

## 重建命令

本命令会删除并重建 `public` schema，必须先确认备份。

```bash
RESET_IDBS_SCHEMA=1 npm run db:reset-schema
```

如果目标不是本地数据库，还需要显式确认：

```bash
RESET_IDBS_SCHEMA=1 ALLOW_PRODUCTION_SCHEMA_RESET=1 npm run db:reset-schema
```

## 后续开发方向

- 删除服务层中的旧字段探测和兼容分支。
- 将 `create-rental-service.js` 按认证、用户、设备、预约、聊天、后台、报表、微信拆分。
- 优先让预约模型完全围绕 `reservation_batches` 和 `reservation_items` 工作。
- 旧 `POST /api/:action` 已删除，前端和外部客户端必须使用 REST API。
