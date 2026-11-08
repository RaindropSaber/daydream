# Daydream

让白日梦成为影像。

Daydream 是一个本机运行的 AI 分集视频创作工作台，把项目构思、故事、分镜、人物与场景设定、视频生成、审阅和成片导出放在同一个工作区。

[快速开始](#快速开始) · [使用说明](docs/user-guide.md) · [配置指南](docs/configuration.md) · [参与贡献](CONTRIBUTING.md) · [MIT License](LICENSE)

## 能做什么

- **分集创作**：管理项目创作规范、分集大纲和多个制作方案。
- **创作助手**：通过对话和任务技能生成故事、分镜、设定及剪辑草稿，审阅后应用。
- **共享设定**：管理人物、场景和道具，保留剧情状态、参考图和历史版本。
- **图片与视频生成**：接入火山方舟、阿里云百炼，管理生成任务和候选素材；文本服务也支持自定义兼容接口。
- **版本与审阅**：区分草稿、确认稿和已采用素材，上游变化后提示下游待更新。
- **合成导出**：裁切、拼接视频，选择字幕方式，预览并下载成片。

```text
项目构思 → 分集大纲 → 故事 → 分镜与片段 → 设定集 → 生成与审阅 → 合成导出
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

1. 打开「模型管理」，填写所用服务的连接信息，并选择文本、助手、图片和视频模型。
2. 创建项目，填写创作方向、风格、画幅及统一创作规范。
3. 创建分集，依次完成故事、视频方案和设定集。
4. 生成并采用视频片段，在「合成导出」中制作成片。

应用可以先启动再配置模型。AI 功能需要自己的供应商账号、API Key 和相应模型权限，调用费用由供应商收取。模型目录中可见不代表已获得调用权限。详细操作见[使用说明](docs/user-guide.md)。

## 配置与数据

推荐通过「模型管理」配置服务；也可参考 [.env.example](.env.example)，将需要的变量写入本机 `.env.local`。完整说明见[配置指南](docs/configuration.md)。

默认工作区为 `data/`：

| 路径                     | 内容                                                   |
| ------------------------ | ------------------------------------------------------ |
| `data/frameflow.sqlite3` | 项目、版本、任务及加密配置；保留旧名称以兼容已有工作区 |
| `data/media/`            | 设定图、视频和导出文件                                 |
| `data/.encryption-key`   | 用于解密已保存模型配置的本机密钥                       |
| `data/backups/`          | 数据迁移工具产生的备份                                 |

按 Ctrl+C 关闭应用后，数据仍保留。备份时需同时保留数据库、媒体和加密密钥；设置了自定义路径时也需包含对应位置。操作步骤见[备份、恢复与迁移](docs/data-management.md)。上述本机数据与环境配置不提交到 Git。

当前应用面向**本机单用户**使用，仅监听 `127.0.0.1`，尚未提供账户系统和多人权限。连接外部模型时，调用所需的文本、图片或音频会发送给你配置的服务。

## 生产运行

在项目根目录执行：

```sh
npm ci
npm run build
npm start
```

网页、API、媒体读取和后台任务由同一个 Node 应用提供。无需另外启动 worker。开发模式和生产模式应轮流运行，避免争用同一个端口和工作区。

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
