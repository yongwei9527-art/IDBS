# IDBS VPS + PostgreSQL 部署

IDBS 是一个可部署在 Ubuntu VPS 上的 Node.js + PostgreSQL 设备借还/预约系统。

部署或使用前，请先阅读 [免责声明](./DISCLAIMER.md)。

## 一键安装

在 VPS 终端执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

这条命令会自动完成：

- 安装 `git`、`curl`、`nginx`、`nodejs`、`postgresql`
- 拉取 GitHub 仓库到 `/var/www/idbs-src`
- 部署应用到 `/var/www/idbs/current`
- 创建配置文件 `/var/www/idbs/shared/.env`
- 创建本机 PostgreSQL 数据库 `idbs` 和用户 `idbs_user`
- 导入 `sql/schema.sql`
- 安装并启动 `idbs` systemd 服务
- 安装 nginx 反向代理配置

如果你在执行 `sudo nano /var/www/idbs/shared/.env` 时看到 `No such file or directory`，说明一键安装还没有成功跑完。先重新执行上面的一键安装命令。

## 必要操作

### 1. 修改配置

安装完成后再编辑配置文件：

```bash
sudo nano /var/www/idbs/shared/.env
```

至少建议修改：

```bash
ADMIN_PASSWORD=请改成强密码
TOKEN_SECRET=请改成一串很长的随机字符串
CORS_ORIGIN=https://你的域名
```

微信功能需要再填写：

```bash
WECHAT_TOKEN=你的公众号回调Token
WECHAT_APP_ID=你的公众号AppID
WECHAT_APP_SECRET=你的公众号AppSecret
WECHAT_ADMIN_OPENIDS=管理员openid
```

`DATABASE_URL` 默认由安装脚本自动生成，本机 PostgreSQL 部署通常不需要手动修改。

### 2. 重启服务

```bash
sudo systemctl restart idbs
```

### 3. 检查运行状态

```bash
sudo systemctl status idbs
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

浏览器访问服务器公网 IP 即可打开前端页面。

## 手动数据库操作

正常一键安装不需要手动建库。只有在使用外部 PostgreSQL，或自动建库失败时，才需要执行本节。

进入 PostgreSQL：

```bash
sudo -u postgres psql
```

示例 SQL：

```sql
CREATE DATABASE idbs;
CREATE USER idbs_user WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE idbs TO idbs_user;
```

导入表结构：

```bash
cd /var/www/idbs/current
psql "$DATABASE_URL" -f sql/schema.sql
```

如果 `$DATABASE_URL` 没有加载，可以临时执行：

```bash
set -a
source /var/www/idbs/shared/.env
set +a
psql "$DATABASE_URL" -f /var/www/idbs/current/sql/schema.sql
```

## 常用命令

查看日志：

```bash
sudo journalctl -u idbs -f
```

重启服务：

```bash
sudo systemctl restart idbs
```

重载 nginx：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

重新部署最新 GitHub 代码：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

## 项目结构

- 后端入口：`server.js`
- PostgreSQL 连接：`src/lib/db.js`
- 静态前端：`public/`
- 上传目录：`/var/www/idbs/uploads`
- systemd 服务：`idbs`
- nginx 配置：`/etc/nginx/sites-available/idbs.conf`
- 健康检查：`GET /health`
- 准备状态：`GET /ready`

## 重要说明

- `/var/www/idbs/shared/.env` 是服务器上的运行配置文件，不会提交到 GitHub。
- 默认安装使用本机 PostgreSQL；外部数据库只需要修改 `DATABASE_URL` 和 `PGSSL`。
- 如果修改了 `.env`，必须执行 `sudo systemctl restart idbs` 才会生效。
- 公众号已发送消息无法通过微信 API 撤回，日报推送采用“新消息覆盖关注点”的业务口径。
