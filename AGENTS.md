# AGENTS.md

## 项目

AI 对话本地归档（Chrome MV3 浏览器扩展）。架构与约束见 [README.md](README.md) 与 [docs/技术方案.md](docs/技术方案.md)。

硬性约束（CI 检查）：

- `content/adapters/` 之外不允许平台选择器或域名判断
- `core/` 不依赖 `chrome.*`
- 全库禁止 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`（ESLint `no-restricted-globals` + CI 兜底 grep）

## 本机环境要点（macOS）

- **PATH 陷阱**：命令执行环境是非交互 shell，不读 `~/.zshrc`，PATH 里没有 `/opt/homebrew/bin`。`gh`、`node`、`pnpm` 需全路径或显式加 PATH：
  - `gh` → `/opt/homebrew/bin/gh`
  - `pnpm test / typecheck / build` → `PATH=/opt/homebrew/bin:$PATH pnpm ...`（本机 DSH 自带 Node 与 rollup 原生二进制有签名冲突，必须用 Homebrew Node）
- **代理**：安装依赖卡住/超时时 `export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897` 后再跑 pnpm。仓库已配置 repo-local `http.proxy` 供 git 推送用
- **全局 gitignore**：`~/.config/git/.gitignore_global` 若含 `*.yaml` 会误伤 `pnpm-lock.yaml` / `pnpm-workspace.yaml`（已发生过）；新增 yaml 文件后务必 `git status` 确认入册，必要时 `git add -f`
- **pnpm 12 注意**：`onlyBuiltDependencies` 已废弃，构建脚本批准写在 `pnpm-workspace.yaml` 的 `allowBuilds`；`package.json` 的 `pnpm` 字段不再被读取

## 常用命令

```bash
PATH=/opt/homebrew/bin:$PATH pnpm test        # 91 条测试
PATH=/opt/homebrew/bin:$PATH pnpm typecheck   # tsc --noEmit
PATH=/opt/homebrew/bin:$PATH pnpm lint        # eslint（含零上传红线）
PATH=/opt/homebrew/bin:$PATH pnpm build       # 产出 dist/
```

## 修改约定

- 改动后必须 `pnpm test && pnpm typecheck && pnpm lint` 全绿再提交
- 真实页面夹具（tests/integration/fixtures/real/）入库前必须脱敏：邮箱/姓名/user-id/token/IP 一律替换为占位值（参见 git 历史中的脱敏提交）
- 提交信息用中文、前缀约定：`feat/fix/perf/chore/ci/security/docs`
