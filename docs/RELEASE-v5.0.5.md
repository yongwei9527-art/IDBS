# IDBS v5.0.5 发布说明

发布日期：2026-07-29

## 版本元数据

- Git 标签：`v5.0.5`
- 根项目：`5.0.5`
- Web：`5.0.5`
- Android：`versionName 5.0.5`，`versionCode 50005`
- Android 包名：`com.laboratory.managementsystem`

## 本版主要功能

### 实验室总群公告

- 实验室总群支持群公告。
- 只有具备相应管理权限的管理员可以发布公告；普通成员只能查看。
- 点击群公告可以查看当前公告与历史版本。
- 成员进入实验室总群时会自动弹出最新公告。
- 每次发布都会创建新版本，旧公告继续保留。

### 后台注册批准码

- 后台用户管理可查看普通用户注册批准码。
- 默认每 `1` 分钟自动轮换，有效期可设置为 `1–1440` 分钟。
- 支持手动刷新；修改时限也会轮换当前批准码。
- 相关接口均要求 `user.approve` 权限。

### Android FCM 推送

- Android 客户端已接入 Capacitor Push Notifications，服务端支持 FCM 设备令牌登记与推送。
- FCM 是可选能力：未配置 Firebase 时，应用仍可构建和运行，前台 WebSocket/站内通知保留，但后台、锁屏推送不可用。
- 正式构建若需 FCM，请配置 GitHub Secret `ANDROID_GOOGLE_SERVICES_JSON_BASE64`（完整 `google-services.json` 的 Base64）。
- 服务端还需安全配置 `FCM_SERVICE_ACCOUNT_JSON`；不要把 Firebase 凭据提交到仓库或上传到 Release。

### 用户与设备删除

- 最高管理员可在权限与业务约束允许时删除单个或批量用户。
- 最高管理员可删除单个或批量设备；服务端会执行关联状态检查与审计记录。
- 最高管理员账号受保护，不能通过普通删除流程移除。

### VPS 安装、升级与 `db` 面板

当前代码包含交互式 VPS 安装、保留数据升级、安装前备份、最高管理员初始化以及服务器管理面板：

- 首次安装可使用自动生成的强临时密码，也可输入自定义最高管理员账号、姓名和密码。
- 域名可留空；留空时使用服务器 IP。填写域名时可选择申请 Let's Encrypt HTTPS。
- 安装完成会输出 App 服务器连接地址、网页访问地址、最高管理员账号与临时密码。
- 最高管理员首次登录或重置后必须立即修改临时密码。
- `sudo db` 提供：`1) 查看连接和管理员信息`、`2) 重置最高管理员账号密码`、`3) 退出`。
- 升级脚本会先备份 PostgreSQL 和上传文件，再拉取目标版本、部署并执行健康检查。

## GitHub Release 产物

标签工作流会生成正式签名产物：

- `Laboratory-Management-System-v5.0.5.apk`
- `Laboratory-Management-System-v5.0.5.aab`
- `SHA256SUMS-v5.0.5.txt`

为已安装 GitHub v5.0.4 Debug 包的设备，发布时还会额外上传：

- `Laboratory-Management-System-v5.0.5-debug-upgrade.apk`
- `SHA256SUMS-v5.0.5-debug-upgrade.txt`

该兼容包已核对与 v5.0.4 公布 APK 使用同一 Debug 证书，仅用于从旧测试包直接覆盖升级；全新安装优先使用正式签名 APK。

正式发布要求以下 GitHub Secrets：

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_STORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

可选 FCM Secret：

- `ANDROID_GOOGLE_SERVICES_JSON_BASE64`

未配置签名 Secrets 时正式 APK/AAB 构建会失败；未配置可选 FCM Secret 时构建继续，但 Android FCM 不可用。

## Android 安装与升级

1. 从 GitHub Release 下载 `Laboratory-Management-System-v5.0.5.apk`。
2. 使用 `SHA256SUMS-v5.0.5.txt` 核对文件完整性。
3. 在 Android 中允许当前文件管理器或浏览器“安装未知应用”，然后安装 APK。
4. 首次启动后输入安装程序输出的 App 服务器连接地址。

> **签名切换提醒：** v5.0.4 公开产物为 Debug 签名 APK。Android 通常不允许不同签名的 APK 覆盖安装，因此旧 Debug 版不一定能直接升级到 v5.0.5 正式签名版。若提示签名冲突，需要先卸载旧版再安装；卸载可能清除 App 本地数据，请先确认服务器数据已同步并记录服务器地址。

## Ubuntu VPS 首次安装

支持 Ubuntu 22.04 / 24.04。准备一台可使用 `sudo` 的服务器，并确保 80/443 端口可访问。

```bash
git clone --branch v5.0.5 --depth 1 https://github.com/yongwei9527-art/IDBS.git /tmp/IDBS-v5.0.5
cd /tmp/IDBS-v5.0.5
sudo env BRANCH=v5.0.5 bash scripts/install-vps.sh
```

安装向导将依次处理：

1. 安装系统依赖、Node.js、PostgreSQL、Nginx；
2. 询问域名（可留空）与 HTTPS；
3. 生成默认最高管理员临时密码，或接受自定义账号密码；
4. 安装依赖、构建 Web、初始化数据库并运行迁移；
5. 配置 systemd、Nginx、每日数据库备份和管理命令；
6. 输出连接地址、网页地址、最高管理员账号与临时密码。

安装后常用命令：

```bash
sudo db
sudo systemctl status laboratory_management_system
sudo journalctl -u laboratory_management_system -n 100 --no-pager
```

默认目录：

- 源码：`/var/www/laboratory-management-system-src`
- 当前运行版本：`/var/www/laboratory-management-system/current`
- 环境配置：`/var/www/laboratory-management-system/shared/.env`
- 上传文件及导出文件：`/var/www/laboratory-management-system/uploads`
- 异步 CSV 导出：`/var/www/laboratory-management-system/uploads/exports`
- 数据库及升级备份：`/var/www/laboratory-management-system/backups`
- 安装连接信息：`/var/www/laboratory-management-system/shared/install-info`（仅 root 可读）

导出的 CSV 不应由 Nginx 直接公开；应通过已认证的后台下载接口获取。

## VPS 升级到 v5.0.5

已安装服务器可固定升级到本标签：

```bash
sudo env RELEASE_REF=v5.0.5 laboratory-management-system-update
```

也可运行仓库脚本：

```bash
cd /var/www/laboratory-management-system-src
sudo env RELEASE_REF=v5.0.5 bash scripts/update-vps.sh
```

升级流程会在 `/var/www/laboratory-management-system/backups` 中创建升级前数据库备份；上传文件备份会排除可重新生成的 `uploads/exports`。升级失败时不要删除备份，先检查 systemd 日志和 `/ready` 健康检查。

## 安全注意事项

- 最高管理员临时密码会以明文写入 root-only 的安装信息文件，仅用于首次登录或重置；登录成功后立即修改。
- 不要把 `.env`、数据库备份、keystore、`google-services.json`、Firebase 服务账号 JSON 上传到 GitHub Release。
- 公网部署优先使用域名和 HTTPS；仅在可信网络中使用 HTTP/IP 方式。
- Release APK/AAB 必须使用长期保存且一致的正式证书签名，否则后续版本无法覆盖升级。
