# Daydream

让白日梦成为影像。

Daydream 是一个本机运行的 AI 分集视频创作工作台，把项目构思、故事、分镜、人物与场景设定、视频生成、审阅和成片导出放在同一个工作区。

[快速开始](#快速开始) · [使用说明](docs/user-guide.md) · [配置指南](docs/configuration.md) · [参与贡献](CONTRIBUTING.md) · [MIT License](LICENSE)

## 能做什么

- **分集创作**：管理视频制作设置、分集大纲和多个制作方案。
- **创作助手**：通过对话和任务技能生成故事、分镜、设定及剪辑草稿，审阅后应用。
- **共享设定**：管理人物、场景和道具，保留剧情状态、参考图和历史版本。
- **图片与视频生成**：接入火山方舟、阿里云百炼，管理生成任务和候选素材；文本服务也支持自定义兼容接口。
- **版本与审阅**：区分草稿、确认稿和已采用素材，上游变化后提示下游待更新。
- **合成导出**：裁切、拼接视频，选择字幕方式，预览并下载成片。

```text
项目
├─ 视频制作：分集 → 选择故事章节 → 分镜与资源 → 视频生成与审阅 → 合成导出
└─ 故事创作：构思 → 世界与人物 → 全书大纲 → 章节写作与定稿
```

## 快速开始

需要 **Node.js 22.16+**、随 Node.js 提供的 npm，以及用于安装依赖的网络连接。运行时使用 Node 内置 SQLite，无需单独安装数据库或 Python。FFmpeg 可执行文件由 npm 依赖提供，也可自行指定。

```sh
git clone https://github.com/RaindropSaber/daydream.git
cd daydream
npm ci
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。首次启动会自动创建数据库并执行迁移。

1. 首页右上角点击「登录」，输入手机号与密码（新用户填写名称并确认密码后提交加入申请，管理员通过后才能登录），登录后从右上角账号菜单打开「模型配置」，填写服务连接信息，并选择文本、助手、图片和视频模型。
2. 创建项目，只需填写名称和简介；视觉风格、画幅、美术规范与改编要求在视频制作的「制作设置」中配置。
3. 在项目的「故事创作」中写作并定稿章节，再进入「视频制作」创建分集、选择章节和完成「分镜与资源」；分镜生成和素材匹配可分别配置模型。
4. 生成并采用视频片段，在「合成导出」中制作成片。

应用可以先启动再配置模型。AI 功能需要自己的供应商账号、API Key 和相应模型权限，调用费用由供应商收取。模型目录中可见不代表已获得调用权限。详细操作见[使用说明](docs/user-guide.md)。

## 管理员与邀请审核

当前采用邀请制准入。新用户在登录弹窗填写手机号、密码和用户名后提交申请，待审核期间不会获得登录会话。管理员在 `/admin` 中通过或拒绝申请，也可停用、恢复已通过用户。后台和头像下拉菜单中的管理员入口每 15 秒刷新待审核信息，当前通知方式为站内列表和数量提示。

首次启动且还没有管理员时，首页会进入 `/admin/setup` 初始化页面。服务器启动日志会自动输出一次性初始化链接，打开后填写手机号、账户名、密码和确认密码，完成后自动登录管理后台。链接 24 小时有效；过期后重启服务会生成新链接。初始化口令仅在服务器日志和工作区的 `.initial-admin-setup-token` 文件中提供，不会通过公开页面签发。已有任何管理员账号后，首次初始化入口关闭，停用管理员也不会重新开放该入口。

后续可在管理后台的「已通过」列表中，将普通用户「设为管理员」并确认。原账户名、密码和项目数据保留，旧登录会话注销，用户重新登录后获得管理员权限。待审核用户需先通过审核。操作会记录授权管理员和时间。

服务器上继续保留直接添加管理员的命令，首次创建、后续新增和恢复管理权限都可使用：

```sh
npm run admin:create -- <管理员手机号>
```

也可以运行 `npm run admin:create`，按提示输入手机号。新手机号会要求输入账户名、密码及确认密码，密码不回显；已有手机号会显示账号信息，输入 `yes` 确认后设为管理员，保留名称、原密码和项目数据，并注销其旧登录会话。已开通的管理员再次执行时不作修改。

命令使用当前服务器的工作区配置（`.env.local`、`DATA_DIR`、`SQLITE_PATH`），并显示实际数据库路径。该命令不会重置已有账号密码；密码重置属于独立流程。普通用户仍需在后台审核后才能登录。

## 配置与数据

推荐通过「模型管理」配置服务；也可参考 [.env.example](.env.example)，将需要的变量写入本机 `.env.local`。完整说明见[配置指南](docs/configuration.md)。

默认工作区为用户主目录下的 `~/.daydream/`：

| 路径                            | 内容                             |
| ------------------------------- | -------------------------------- |
| `~/.daydream/frameflow.sqlite3` | 项目、版本、任务及加密配置       |
| `~/.daydream/media/`            | 设定图、视频和导出文件           |
| `~/.daydream/.encryption-key`   | 用于解密已保存模型配置的本机密钥 |
| `~/.daydream/backups/`          | 数据迁移工具产生的备份           |

按 Ctrl+C 关闭应用后，数据仍保留。备份时需同时保留数据库、媒体和加密密钥；设置了自定义路径时也需包含对应位置。操作步骤见[备份、恢复与迁移](docs/data-management.md)。上述本机数据与环境配置不提交到 Git。

当前应用默认仅监听 `127.0.0.1`。首页公开访问，手机号与密码登录在弹窗内完成，首次登录补充用户名称后提交加入申请，管理员通过后才能登录（当前支持中国大陆 +86 手机号，不进行短信验证）。账号分别保存项目、模型配置及生成媒体；密码以 scrypt 加盐哈希保存，会话有效期为 7 天，退出后立即失效。点击右上角头像进入「我的项目」，左上角 Daydream 返回首页；头像按手机号通过 Boring Avatars 的 beam 样式生成。下拉菜单提供账户设置、模型配置和退出；管理员在下拉菜单中额外看到「管理后台」入口及待审核数量。账户设置支持修改账户名和密码，手机号只读；改密需验证原密码，成功后退出所有设备。暂不提供密码找回或短信验证。原有工作区账号和数据保留在数据库中，不自动归属新手机号。连接外部模型时，调用所需的文本、图片或音频会发送给你配置的服务。

## 生产运行

在项目根目录执行：

```sh
npm ci
npm run build
npm start
```

网页、API、媒体读取和后台任务由同一个 Node 应用提供。无需另外启动 worker。开发模式和生产模式应轮流运行，避免争用同一个端口和工作区。

## Docker 运行

VPS 与反向代理的部署方式见 [VPS 镜像部署](docs/deployment.md)，生产配置为 [compose.production.yaml](compose.production.yaml)。

镜像仓库：[raindropsaber/daydream](https://hub.docker.com/r/raindropsaber/daydream)，提供 `latest` 和 `0.2.0` 标签，当前平台为 `linux/amd64`。私有仓库需先登录有访问权限的 Docker Hub 账号，再拉取并启动：

```sh
docker login
docker pull raindropsaber/daydream:0.2.0
docker run -d --name daydream --init --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v daydream-data:/data \
  raindropsaber/daydream:0.2.0
docker logs -f daydream
```

### 从源码构建

安装 Docker Engine / Docker Desktop（含 Compose）后，在项目根目录执行：

```sh
docker compose up -d --build
docker compose logs -f daydream
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。首次启动从日志取得管理员初始化链接，将链接中的 `0.0.0.0:3000` 替换为浏览器实际访问的 `127.0.0.1:3000`，保留完整路径和 token。模型连接可在登录后通过界面配置。容器内同时运行网页、后台任务和 SQLite，无需额外数据库或 worker。

镜像名为 `daydream:local`，使用非 root 用户运行，包含 FFmpeg 和中文字幕字体。数据库、媒体、加密密钥及初始化口令都保存在挂载到 `/data` 的 `daydream-data` 命名卷中。`docker compose down` 后这些数据仍保留；`docker compose down -v` 会删除数据卷及其中全部数据。备份需保留整个 `/data`，并在服务停止后进行；同一数据卷只供一个应用实例使用。

Compose 默认只向宿主机的 `127.0.0.1:3000` 发布端口。修改宿主机端口时，例如 `127.0.0.1:8080:3000`，容器内端口仍保持 `3000`。如需通过其他主机名访问，在 `compose.yaml` 中调整端口绑定，并在 `TRUSTED_HOSTS` 中加入实际域名或 IP（不含协议和端口，逗号分隔，保留 `127.0.0.1` 供健康检查使用）。

也可直接构建和运行镜像：

```sh
docker build -t daydream:local .
docker run -d --name daydream --init --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v daydream-data:/data \
  daydream:local
```

镜像不会包含本机 `.env.local`、项目数据或 API Key。需要用环境变量配置模型时，`docker run` 可添加 `--env-file /path/to/docker.env`；Compose 则可在服务中添加 `env_file`。环境文件只填写所需模型变量，路径和监听配置使用上面的容器值。不要把凭据写入 Dockerfile。容器中添加管理员可执行：

```sh
docker compose exec daydream npm run admin:create -- <管理员手机号>
```

如需把镜像传到其他机器，使用相同 CPU 架构构建后导出、传输并加载：

```sh
docker save -o daydream-image.tar daydream:local
# 在目标机器上执行：
docker load -i daydream-image.tar
```

镜像包含平台相关的 FFmpeg 和 Node 依赖；跨 CPU 架构部署时需要为目标平台重新构建，例如 `docker buildx build --platform linux/amd64 -t daydream:local --load .`。镜像不包含数据卷；已有数据需要单独备份和恢复。

## 开发

技术栈：Next.js App Router、React、TypeScript、Node.js、SQLite、shadcn/ui 和 Tailwind CSS。

```sh
npm run typecheck
npm test
npm run build
```

测试使用临时 SQLite 工作区，外部模型接口采用模拟响应，视频合成测试运行真实 FFmpeg；不会调用付费模型。开发流程见[贡献指南](CONTRIBUTING.md)。

## 文档

- [文档索引](docs/README.md)
- [使用说明](docs/user-guide.md)：项目、模型、分集、设定与导出。
- [配置指南](docs/configuration.md)：环境变量、服务连接和本机路径。
- [备份、恢复与迁移](docs/data-management.md)：保存工作区及导入旧版数据。
- [故障排查](docs/troubleshooting.md)：启动、模型调用、任务和导出问题。
- [架构与数据库](docs/architecture.md)：进程、实体关系和任务恢复机制。
- [创作流程与助手协作](docs/creation-workflow.md)：技能、引用和草稿应用规则。
- [更新记录](CHANGELOG.md)

## 许可证

Daydream 源码采用 [MIT License](LICENSE)。第三方依赖适用各自的许可证；外部模型服务的使用及生成内容适用相应服务条款。
