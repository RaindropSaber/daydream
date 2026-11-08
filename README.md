# Daydream

让白日梦成为影像。Daydream 是从故事到成片的 AI 分集创作工作台。

分集视频制作工作台，使用 Next.js App Router、React、TypeScript、Node.js、SQLite、shadcn/ui 和 Tailwind CSS。网页、API、媒体读取和后台任务运行在同一个 Node 应用进程中。

## 启动

需要 Node.js 22.16+。在项目根目录执行：

```sh
npm ci
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。应用使用 Node 内置 SQLite，启动时自动创建数据库并执行迁移，无需安装或单独启动数据库。按 Ctrl+C 关闭应用，数据会保留。

默认数据库文件为 `data/frameflow.sqlite3`（保留旧版路径，兼容已有工作区）。可在 `.env.local` 中设置 `DATA_DIR` 更改整个工作区目录，或用 `SQLITE_PATH` 指定数据库文件。迁移亦可单独运行 `npm run db:migrate`。

## 原有数据迁移

```sh
npm run db:import
```

从 `data/studio.sqlite3` 导入项目、分集、制作方案、内容版本、资源、对话、任务及导出记录，模型配置从 `data/seedance.json` 导入并加密。导入器使用 Node 内置 SQLite 读取，先创建一致性备份，再在事务中写入新的 SQLite 数据库；重复导入同一快照不会产生重复记录。同 ID 的不同快照会拒绝覆盖。媒体保留原路径，无需重新生成。

从当前 PostgreSQL 工作区迁回时，先停止应用、保持原 PostgreSQL 运行，并在 `.env.local` 或环境中设置原 `DATABASE_URL`，然后执行：

```sh
npm run db:import:postgres
```

此命令以只读一致性快照备份 PostgreSQL，向空的目标 SQLite 导入所有实体与加密配置，逐表核对内容并校验外键；目标已有数据时拒绝覆盖。它只用于迁移，应用运行不读取 `DATABASE_URL`，也不连接 PostgreSQL。迁移完毕即可关闭原 PostgreSQL。

旧数据库和配置不会被删除。备份在 `data/backups/`，请妥善保管，其中可能含历史敏感配置。导入历史状态时，若旧服务仍可用会核对其有效媒体状态；无法核验的媒体保留为待审阅，避免误认为当前结果。

## 模型与文件

模型密钥可在「模型管理」中配置，也可使用环境变量，见 [.env.example](.env.example)。数据库中的密钥采用 AES-256-GCM 加密，解密密钥位于 `data/.encryption-key`，不会发给浏览器。

`data/media/` 存储设定图、视频和导出文件。视频处理使用 npm 提供的 FFmpeg 原生可执行文件，可通过 `FFMPEG_BIN` 指定其他路径。应用和迁移均不依赖 Python。

备份和恢复时需要同时保留 SQLite 数据库、媒体目录及 `.encryption-key`；只恢复数据库无法解密已保存的配置。复制数据库文件前请停止应用，或使用 SQLite 的在线备份工具；运行时尚未合并的数据可能位于同目录的 `-wal` 文件中。

## 构建与验证

```sh
npm run typecheck
npm test
npm run build
npm start
```

测试自动创建独立临时 SQLite 文件并清理，不需要数据库服务，不改动工作项目；外部模型接口使用模拟响应，视频合成执行真实 FFmpeg。测试不会调用付费模型。

`npm start` 使用生产构建，仍由同一个 Node 服务提供网页、API、媒体和任务执行。服务默认仅监听 `127.0.0.1:3000`，目前为本机单用户应用。

## 目录

```text
src/app/                  Next.js 页面、API 与媒体路由
src/components/studio/    React 工作台页面和交互
src/components/ui/        shadcn/ui 组件
src/lib/server/           数据库、业务逻辑、模型适配、任务与视频处理
src/lib/domain.ts         版本依赖、有效性及状态规则
src/lib/types.ts          浏览器与服务端共享类型
scripts/                  Node 启动、数据库与数据导入
db/sqlite-migrations/    SQLite 版本化 SQL 迁移
db/migrations/           历史 PostgreSQL 迁移（运行时不使用）
tests/                    领域规则与 SQLite 集成测试
docs/                     架构与使用说明
data/                     本机数据与密钥（Git 忽略）
```

- [架构与数据库](docs/architecture.md)
- [使用说明](docs/user-guide.md)

源码在 Git 中维护，数据库、密钥、媒体、构建结果及本机环境文件不提交。

## 许可证

本项目采用 [MIT License](LICENSE)。
