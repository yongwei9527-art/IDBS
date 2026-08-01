# IDBS v5.0.6 发布说明

发布日期：2026-08-01

## 版本元数据

- Git 标签：`v5.0.6`
- 根项目：`5.0.6`
- Web：`5.0.6`
- Android：`versionName 5.0.6`，`versionCode 50006`
- Android 包名：`com.laboratory.managementsystem`

## 本版主要功能

### VPS 一键安装、更新与备份

- 新增 `scripts/install.sh`，支持 Ubuntu/Debian VPS 交互安装。
- 域名可留空；可选择 HTTPS，并支持自定义最高管理员账号和密码。密码留空时生成强随机密码，仅在安装终端显示。
- 可配置导出、上传、备份和数据库运维目录。
- 新增 `scripts/update.sh`，更新前执行备份、部署代码、运行迁移、重启并检查健康状态。
- 新增 `scripts/backup.sh`，支持 PostgreSQL、上传文件和导出文件备份、校验与保留期清理。

### App 下载页与服务器配置

- 新增 `/download` 页面，提供网页版入口、Android APK 下载入口和服务器配置状态。
- 新增公开配置接口：
  - `GET /api/v5/app-config`
  - `GET /api/v5/app-pairing`
  - `GET /api/v5/app-pairing/qr.svg`
  - `POST /api/v5/app-pairing/exchange`
- 二维码使用短期签名令牌，只用于验证并保存服务器地址，不创建登录会话，也不授予任何管理员权限。

### Android 安全配对

- 支持 `labapp://pair` 深度链接；外部相机或浏览器扫码后可唤起 App。
- 配对令牌只保存在内存中，兑换完成后立即清除。
- 验证后的服务器地址使用 Android Keystore 派生的 AES-GCM 密钥加密保存。
- 登录页支持处理待配对链接、粘贴配对链接和恢复已保存的服务器地址。
- 配对完成后，用户仍必须使用自己的账号和密码登录。

### 安全限制

- 扫码配对仅在 `APP_PUBLIC_URL` 为标准 HTTPS 域名、使用 443 端口且配置至少 32 位有效 `APP_PAIRING_SECRET` 时启用。
- HTTP/IP、非 443 HTTPS 或缺少安全配对密钥时，下载页隐藏二维码；网页版和 App 手动服务器地址配置仍可使用。
- 管理员密码、数据库密码、JWT 密钥、`APP_PAIRING_SECRET`、Android 签名材料和 Firebase 服务账号不会写入二维码、APK、前端或 Release。

## GitHub Release 产物

标签工作流使用 GitHub Secrets 中的长期正式签名材料生成：

- `Laboratory-Management-System-v5.0.6.apk`
- `Laboratory-Management-System-v5.0.6.aab`
- `SHA256SUMS-v5.0.6.txt`

正式发布要求以下 GitHub Secrets：

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_STORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

可选 FCM Secret：

- `ANDROID_GOOGLE_SERVICES_JSON_BASE64`

未配置正式签名 Secrets 时工作流会失败，不会回退为 Debug 签名包。未配置可选 FCM Secret 时仍可生成正式安装包，但 Android 后台 FCM 推送不可用。

## Android 安装与升级

1. 从 GitHub Release 下载 `Laboratory-Management-System-v5.0.6.apk`。
2. 使用 `SHA256SUMS-v5.0.6.txt` 核对文件完整性。
3. 在 Android 中允许当前浏览器或文件管理器安装未知应用，然后安装 APK。
4. 打开部署服务器的 `/download` 页面：标准 HTTPS/443 部署可扫码配对；其他部署在 App 登录页手动输入服务器地址。
5. 使用自己的普通用户或管理员账号登录。最高管理员账号和密码不会写入 App。

已安装 v5.0.5 正式签名版时，只要 GitHub Secrets 中继续使用同一签名证书，即可直接覆盖升级。v5.0.4 Debug 包签名不同，需先按 v5.0.5 发布说明完成签名迁移，或卸载旧版后安装；卸载可能清除本地保存的服务器地址和登录状态，但不会删除服务器数据。

## Ubuntu VPS 首次安装

```bash
git clone --branch v5.0.6 --depth 1 https://github.com/yongwei9527-art/IDBS.git /tmp/IDBS-v5.0.6
cd /tmp/IDBS-v5.0.6
sudo bash scripts/install.sh
```

也可以执行：

```bash
curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/v5.0.6/scripts/install.sh | sudo env BRANCH=v5.0.6 bash
```

安装结束后会输出系统地址、后台地址、App 下载页、最高管理员账号和首次登录密码。随机密码只在安装终端显示；首次登录后应立即修改。

## VPS 升级到 v5.0.6

```bash
cd /var/www/laboratory-management-system-src
sudo env RELEASE_REF=v5.0.6 bash scripts/update.sh
```

升级前会创建备份，升级后检查 `/ready`。发生失败时不要删除备份，应先检查 systemd 日志和数据库迁移状态。

## 发布安全检查

- 不上传 `.env`、数据库备份、导出表格、用户上传文件、keystore、签名口令、`google-services.json` 或 Firebase 服务账号 JSON。
- 不上传 Debug APK 冒充正式包。
- Release 中只保留正式签名 APK、AAB 和对应 SHA-256 校验文件。
- 第一次登录后立即修改安装器生成的最高管理员临时密码。
