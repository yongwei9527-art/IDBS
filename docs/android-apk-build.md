# Android APK Build Guide

本项目使用 Capacitor 将 Vite/React 前端打包为 Android APK。APK 内是静态前端；Node.js + PostgreSQL 后端仍需部署在可访问的服务器上。
## 首次服务器配对（推荐）

部署完成后在手机浏览器打开 `https://<服务器>/download` 并安装管理员发布的 APK。请用手机系统相机扫描下载页二维码，再选择“使用实验室管理系统打开”；当前版本不内置相机扫描器。若系统相机无法唤起 App，可复制下载页提供的短期配对链接，粘贴到 App 登录页。v2 二维码优先使用同源 HTTPS App Link：

```text
https://lab.example.com/api/v5/app-pairing/link?v=2&server=https%3A%2F%2Flab.example.com&token=<短期令牌>
```

未配置 App Links 时，服务端会回退到内容相同的 `labapp://pair?v=2&...` 自定义链接。Android 和 Web 层都会严格要求 v2、规范 HTTPS Origin、固定路径、且只允许 `v`、`server`、`token` 各出现一次；HTTPS 链接的 Origin 必须与 `server` 完全一致。

扫码载荷中的 `token` 只临时保留在内存中。App 使用本机首次生成并持久化的随机 `installation_id` 调用 `POST /api/v5/app-pairing/exchange`，一次性兑换服务器公开配置，随后清除 token。`installation_id` 不是账号、密码或设备硬件标识，不用于自动登录。

兑换成功后 App **不会立即保存**：登录页会显示组织名、实例名、HTTPS Origin 和 SHA-256 身份指纹，必须由用户明确确认（TOFU，首次使用信任）。确认后完整身份在 Android Keystore 保护的 AES-GCM 配置中持久化，并同步保存前端可信身份：

- 同一 Origin 返回相同实例 ID 和指纹时，可视为已识别服务器；显示名称变化不改变安全身份。
- 同一 Origin 的实例 ID 或指纹变化会被直接阻断，不能用“允许切换服务器”绕过。
- 跨 Origin 切换必须再次明确确认；App 会先注销并清理旧服务器会话，再保存新服务器。
- 配对只配置服务器，不会携带管理员密码或自动登录；完成后仍需使用用户自己的账号和密码。

二维码或 token 过期时，返回 `/download` 刷新页面重新扫码。无法扫码时，可继续使用登录页已有的手动服务器地址输入作为后备。禁止将管理员密码、数据库密码、JWT、`APP_PAIRING_SECRET` 或 Android 签名密钥放入 APK、二维码或 GitHub。

## 1. 有域名 / 无域名

APK **不再写死** 后端地址。用户在登录页填写服务器地址，系统会自动补协议并推导 API / WebSocket 地址：

| 场景 | 登录页填写示例 | 实际 API 请求 | 适用范围 |
| --- | --- | --- | --- |
| 有域名 VPS（推荐生产） | `rent.example.com` 或 `https://rent.example.com` | `https://rent.example.com/api/v5` | 正式 APK / 浏览器，推荐长期使用。 |
| 无域名 VPS | `203.0.113.10` 或 `http://203.0.113.10` | `http://203.0.113.10/api/v5` | 可先用 IP 跑通；安全性不如 HTTPS 域名。 |
| 局域网调试 | `192.168.1.13:3000` | `http://192.168.1.13:3000/api/v5` | 开发机直连 Vite/API 调试。 |
| 模拟器访问本机 | `10.0.2.2:3000` | `http://10.0.2.2:3000/api/v5` | Android 模拟器调试。 |

规则：

- 域名默认走 **HTTPS**。
- 公网 IP / 局域网 IP / localhost 默认走 **HTTP**。
- VPS 通过 Nginx 对外提供 80 端口时，登录页填 `服务器公网IP` 即可，不需要写 `:3000`。
- 手动地址保存在 `localStorage`；经确认的扫码身份还会以 Android Keystore 保护的完整配置持久化。换服务器会清理旧登录令牌。
- WebSocket 地址由运行时服务器地址推导：`ws(s)://host/api/v5/ws`。

后端 `.env` 的 `CORS_ORIGIN` 需要同时放行 APK WebView 来源 `https://localhost` 和真实服务器来源：

```env
# 有域名生产
CORS_ORIGIN=https://localhost,https://rent.example.com

# 无域名/IP 临时使用
CORS_ORIGIN=https://localhost,http://203.0.113.10

# 局域网调试
CORS_ORIGIN=https://localhost,http://127.0.0.1:3000,http://192.168.1.13:3000
```

安全建议：生产优先使用 HTTPS 域名；无域名 HTTP 可用于临时部署、内网或初次验收，但账号、令牌和业务数据不会获得 HTTPS 传输加密保护。正式 APK 若必须长期连接 `http://公网IP`，需要明确接受明文传输风险后再放开 Android 明文网络策略。

## 2. 创建 / 同步 Android 工程

Android 静态资源单独输出到 `web/dist-android`，不会覆盖服务器网页版的 `public/v5`。Capacitor 仅从该独立目录同步资源。

首次：

```powershell
npm --prefix web run build:android
npm --prefix web run android:add
```

前端变更后：

```powershell
npm --prefix web run android:sync
```

可选构建时默认地址（用户仍可在登录页覆盖）：

```powershell
$env:VITE_API_ORIGIN='http://192.168.1.13:3000'
npm --prefix web run android:sync
```

### 可选：为专属域名启用 Android App Links

通用 APK 默认使用保留域名 `app.invalid` 且 `autoVerify=false`，不会声称已验证任何真实服务器域名。为某个部署构建专属 APK 时，可配置：

```powershell
cd web/android
./gradlew.bat assembleDebug `
  '-PLAB_APP_LINK_HOST=lab.example.com' `
  '-PLAB_APP_LINK_AUTO_VERIFY=true'
```

CI 也可使用等价环境变量 `ANDROID_APP_LINK_HOST` 和 `ANDROID_APP_LINK_AUTO_VERIFY`。Host 只能是 DNS 主机名，不能包含协议、路径、端口或 IP；只有在以下步骤完成后才可将 `autoVerify` 设为 `true`：

1. 复制 `web/android/app-links/assetlinks.json` 模板到服务器 `https://lab.example.com/.well-known/assetlinks.json`。
2. 用正式 Release 签名证书执行 `keytool -list -v -keystore <正式密钥库>`，取得真实 `SHA256` 指纹。
3. 将模板中的 `REPLACE_WITH_YOUR_RELEASE_CERTIFICATE_SHA256_FINGERPRINT` 替换为该真实指纹，并以 `application/json`、无重定向方式公开。
4. 确认模板中的包名仍为 `com.laboratory.managementsystem`，再构建使用同一签名证书的 APK。

仓库不会生成、猜测或伪造正式签名指纹。Debug 指纹不能替代正式 Release 指纹，签名密钥也不得提交到 Git。

## 3. 构建 Debug APK

需要 **Java 21**（Android Studio JBR）与 Android SDK：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
npm --prefix web run android:debug
```

输出：

`web/android/app/build/outputs/apk/debug/app-debug.apk`

## 4. 构建 Release APK

配置签名后：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
npm --prefix web run android:release
```

输出：

`web/android/app/build/outputs/apk/release/app-release.apk`

## 5. USB 连接与开发者选项（华为平板 GOT-W09 等）

**HDB ≠ ADB。**
HDB/HiSuite 只能传文件；Codex 自动安装、日志、截图需要 **USB 调试（ADB）**。

### 打开开发者选项
1. 设置 → 关于平板
2. 连续点击 **版本号 / 编译编号** 7 次，直到提示已处于开发者模式
3. 返回 设置 → 系统和更新 → **开发人员选项**
4. 打开：
   - **USB 调试**（必须）
   - （可选）仅充电模式下允许 ADB 调试
   - HDB 仅 HiSuite 需要，不能替代 USB 调试

### 连接电脑
1. USB 线连接电脑
2. 通知栏选择 **传输文件（MTP）** 或 **仅充电 + USB 调试**
3. 平板弹出 RSA 授权时点 **允许**
4. 电脑验证：

```powershell
adb devices
```

应看到 `device`（不是 `unauthorized` / 空列表）。

### 安装 APK
- 有 ADB：`adb install -r 实验室管理系统-Rental-System-debug.apk`
- 无 ADB：把 APK 拷到「下载」目录，用文件管理器安装（需允许未知来源）

## 6. APK 内实时刷新

- 预约管理频道：`reservations:admin`
- 聊天频道：`chat:<conversationId>`
- WebSocket 地址由运行时服务器地址推导：`ws(s)://host/api/v5/ws`

手机能访问后端、且 CORS 包含 `https://localhost` 时，预约与聊天可在 APK 实时更新。

## 7. 多设备 / 多用户使用建议

- 一个通用 APK + 登录页配置服务器地址
- 生产优先使用 HTTPS 域名，不要把局域网 IP 写死进包
- 多组织隔离后续需要 `tenant_id` / 组织绑定；当前账号体系按角色权限区分

## 8. 安全服务器配对的 HTTPS 限制

扫码配对是导入服务器地址的辅助流程，不是登录或管理员授权流程。二维码中不会包含管理员密码、数据库密码、JWT 密钥、`APP_PAIRING_SECRET` 或任何固定解密密钥；短期配对令牌仅用于与对应服务器兑换公开配置，兑换后用户仍需使用自己的账号和密码登录。

只有在服务端同时满足以下条件时，`/download` 才会显示 App 配对二维码：

- `APP_PUBLIC_URL` 为标准 HTTPS 地址，例如 `https://lab.example.com`；
- 外部 HTTPS 入口使用默认 **443** 端口，不使用 `:8443` 等非标准端口；
- 服务端已配置非空 `APP_PAIRING_SECRET`，且该秘密只保存在服务器环境变量中。

IP/HTTP 安装、证书申请失败或非 443 HTTPS 入口仍可访问网页版，也可让 App 在登录页手动输入服务器地址；但下载页不会提供二维码，且 Android 安全配对不会接受这类地址。请勿尝试通过修改二维码、内置固定密钥或放宽明文网络策略来绕过限制。

### 将 IP/HTTP 部署升级为扫码配对

1. 为服务器配置可访问的域名并完成 DNS 解析。
2. 为域名启用有效 HTTPS 证书，并通过 443 端口提供服务。
3. 在服务器 `.env` 中把 `APP_PUBLIC_URL` 设为不含路径和端口的 HTTPS 原点，例如 `https://lab.example.com`。
4. 在同一服务器 `.env` 中配置高强度随机 `APP_PAIRING_SECRET`；不要把它复制到 APK、前端、二维码、GitHub、Release 或日志。
5. 重启服务后重新打开 `/download`，用手机系统相机扫描新生成的短期二维码并选择唤起 App；二维码过期时刷新下载页重新生成。

在 HTTPS 迁移完成前，使用 App 登录页的手动服务器地址输入作为后备方案即可。
