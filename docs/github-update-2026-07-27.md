# GitHub 更新说明（2026-07-27）

## 推送目标

- 分支：`main`
- 远程：`origin`（`https://github.com/yongwei9527-art/IDBS.git`）
- 产品名称：实验室管理系统
- 应用版本：`0.1.0`
- 兼容 API：继续保留 `/v5/`、`/api/v5` 和 `/api/v5/ws`

## 本次更新内容

### APK 与紧凑布局

- 新增 Capacitor Android 工程和 Debug APK 构建流程。
- 优化平板/手机布局密度，减少无效间隔，在同一屏幕显示更多设备、预约与管理信息。
- 登录页增加服务器地址输入和“实际连接”预览，服务器地址保存在本机，可随时切换。

### 有域名 / 无域名两种连接方式

- 有域名：填写 `rent.example.com` 或完整地址，默认使用 `https://rent.example.com`。
- 无域名：填写公网/局域网 IP，默认使用 `http://IP`；开发机直连可填写 `IP:3000`。
- API 自动使用 `/api/v5`，WebSocket 自动使用 `/api/v5/ws`，无需分别填写。
- 一键安装脚本会询问是否有域名，并把 APK WebView 来源 `https://localhost` 加入 `CORS_ORIGIN`。
- 正式生产推荐域名 + HTTPS；无域名 HTTP 适合初次验收、内网或 Debug 包。正式 APK 若长期使用公网 IP/HTTP，需要明确接受明文传输风险后再放开 Android 明文网络策略。

### 管理员与普通用户权限

- 保留普通管理员快捷授予与撤销能力。
- 管理员权限撤销后刷新相关用户、角色和详情缓存，普通用户侧权限与菜单随之恢复。
- 超级管理员继续受保护，不能通过快捷操作被误撤销。

### 部署与项目命名

- 运行目录、systemd 服务、Nginx 配置和数据库命名统一为 `laboratory-management-system` / `laboratory_management_system`。
- GitHub 仓库仍使用现有公开仓库 `yongwei9527-art/IDBS`，避免一键安装链接指向不存在的新仓库。
- 更新 README、APK 构建指南、生产安全清单和变更记录。

## 验证结果

- `npm run check`：通过。
- `npm run unit`：56/56 通过。
- `npm --prefix web run typecheck`：通过。
- `npm --prefix web run build`：通过。
- Android Debug APK（Java 21）：构建通过。

## 本地 APK

- `实验室管理系统-debug.apk`
- `实验室管理系统-compact-debug.apk`
- SHA-256：`FE686543CC1E3108F4B7C4191395EBD8ABACF0087095D404928E6B84C20D7685`

Debug APK 和测试截图不纳入 Git 源码提交，避免仓库体积持续增长；如需公开下载，建议作为 GitHub Release 附件单独上传。