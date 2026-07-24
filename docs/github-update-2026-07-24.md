# GitHub 更新说明（2026-07-24）

## 推送信息

- 分支：`main`
- 远程：`origin`（`https://github.com/yongwei9527-art/IDBS.git`）
- 提交：`455f2f2 feat-admin-role-controls`

## 本次更新内容

### 管理员权限控制

- 在用户管理页增加快捷授予普通管理员能力。
- 增加撤销普通管理员权限入口。
- 超级管理员不可被快捷撤销，避免权限交接风险。
- 管理员授权、撤销后自动刷新用户列表、角色列表和用户详情缓存。

### 诉求处理页视觉优化

- 用户诉求列表标题与标签分行，降低挤压感。
- 增加等待时效标签，超时诉求更容易识别。
- 调整操作按钮主次：确认优先、处理次级、沟通弱化。

## 验证结果

- `npm --prefix web run typecheck`：通过。
- `git diff --check`：通过，仅存在 Windows 换行提示。
- `git push origin main`：已成功推送到 GitHub。

## 后续建议

- 如需发布正式版本，建议基于 `main` 当前提交创建版本标签。
- 推荐标签名：`v5.0.1-admin-controls` 或 `v5.0.2`。
