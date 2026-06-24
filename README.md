# IDBS VPS + PostgreSQL 部署

IDBS 是一个运行在 Ubuntu VPS 上的设备借还、预约和后台管理系统。后端使用 Node.js + Express，数据库使用 PostgreSQL，前端页面放在 `public/`。

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

如果 `sudo nano /var/www/idbs/shared/.env` 打开是空白，或提示 `No such file or directory`，说明配置文件没有成功生成。请先重新执行上面的一键安装命令，不要保存空白文件。

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

## 模块化结构

后端已经拆成模块，后续升级时优先修改对应文件：

- 启动入口：`server.js`
- 环境配置和就绪检查：`src/config/env.js`
- Express 应用组装：`src/app/create-app.js`
- REST API 路由：`src/routes/rest-api.js`
- 旧版动作路由兼容：`src/routes/legacy-api.js`
- 上传接口：`src/routes/upload.js`
- 微信公众号回调：`src/routes/wechat.js`
- 健康检查：`src/routes/health.js`
- PostgreSQL 连接池：`src/lib/db.js`
- 业务服务：`src/services/create-rental-service.js`
- 每日运营日报调度：`src/tasks/daily-report-scheduler.js`
- 静态前端：`public/`
- 数据库表结构：`sql/schema.sql`

详细维护说明见 [模块维护说明](./docs/module-map.md)。

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

## 重要说明

- `/var/www/idbs/shared/.env` 是服务器上的运行配置文件，不会提交到 GitHub。
- 默认安装使用本机 PostgreSQL；外部数据库只需要修改 `DATABASE_URL` 和 `PGSSL`。
- 如果修改了 `.env`，必须执行 `sudo systemctl restart idbs` 才会生效。
- 公众号已发送消息无法通过微信 API 撤回，日报推送采用“每天发送新日报”的业务口径。
