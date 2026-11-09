# VPS 镜像部署

[返回文档索引](README.md)

生产配置为根目录的 [compose.production.yaml](../compose.production.yaml)。它运行 `raindropsaber/daydream:0.2.0`，把容器 `3000` 端口映射到宿主机 Docker 网桥的 `172.17.0.1:8988`，供现有 Nginx Proxy Manager 转发。网站地址为 `https://daydream.raindrop.cyou`，SQLite、媒体和加密密钥保存在 `daydream-data` 命名卷的 `/data` 目录中。

## 安装与启动

服务器需已安装 Docker 和 Compose，拥有 `172.17.0.1` 网桥地址；反向代理容器需能访问该地址。将生产配置复制到服务器 `/opt/daydream/compose.yaml`。

私有镜像可以在服务器登录有权限的 Docker Hub 账号后拉取，也可以从本机通过 SSH 传输已有镜像。后者无需在 VPS 保存 Docker Hub 凭据：

```sh
docker save raindropsaber/daydream:0.2.0 | gzip -1 | ssh raindrop 'gunzip | docker load'
scp compose.production.yaml raindrop:/opt/daydream/compose.yaml
ssh raindrop 'cd /opt/daydream && docker compose up -d'
```

首次部署前先执行 `ssh raindrop 'mkdir -p /opt/daydream'`。配置使用 `pull_policy: never`，启动前必须完成 `docker load` 或 `docker pull`。已有应用时先核对容器、数据卷和目标文件，避免覆盖其他服务。

默认绑定网桥地址，反向代理的上游保持 `http://172.17.0.1:8988`。代理需保留原始 `Host`，并传递 `X-Forwarded-Proto`；通过 HTTPS 访问时应传递 `https`，让登录 Cookie 和请求来源校验使用正确协议。

## 首次管理员初始化

```sh
ssh raindrop 'docker logs daydream'
# 也可直接读取口令，粘贴到网站的初始化口令输入框：
ssh raindrop 'docker exec daydream cat /data/.initial-admin-setup-token'
```

日志中的 `/admin/setup?token=...` 是一次性管理员初始化链接。将前面的 `http://0.0.0.0:3000` 替换为 `https://daydream.raindrop.cyou`，完整保留路径与 token。在浏览器设置管理员账号后，再配置模型连接。不要公开初始化 token；初始化完成后该入口关闭。

## 检查与维护

```sh
# 服务器端：应用及 SQLite 健康检查
ssh raindrop 'curl -fsS -H Host:daydream.raindrop.cyou http://172.17.0.1:8988/api/health'
# 验证完整 HTTPS 代理链路
curl -fsS https://daydream.raindrop.cyou/api/health
# 容器状态与日志
ssh raindrop 'cd /opt/daydream && docker compose ps'
ssh raindrop 'docker logs --tail 100 daydream'
```

更新时先拉取或传输新镜像，再修改配置中的版本号并执行 `docker compose up -d`。`docker compose down` 保留命名卷；`docker compose down -v` 会删除其中全部数据。备份时停止应用，并备份整个数据卷，包含数据库、媒体和 `.encryption-key`。同一个工作区只运行一个应用实例。

需要更换域名、绑定地址、端口或镜像时，可在服务器 `/opt/daydream/.env` 中设置 `DAYDREAM_PUBLIC_HOST`、`DAYDREAM_BIND_ADDRESS`、`DAYDREAM_PORT` 和 `DAYDREAM_IMAGE`，然后重新执行 `docker compose up -d`。域名不包含协议和端口；修改绑定地址和端口后同步调整代理上游。
