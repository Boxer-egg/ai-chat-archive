# AI 对话本地归档（浏览器扩展）

Chrome MV3 扩展：在支持的 AI 对话页面自动保存消息到本地 IndexedDB。**仅本地，不上传任何数据。**

技术方案见 [docs/技术方案.md](docs/技术方案.md)。

## 开发

```bash
pnpm install
pnpm test        # vitest（88 条单元 + 集成测试）
pnpm typecheck   # tsc --noEmit
pnpm build       # 产出 dist/，chrome://extensions 加载"已解压的扩展程序"
```

> 注意：本机 DSH 自带的 Node 与 rollup 原生二进制存在签名冲突（Team ID 不匹配）。
> 如遇 `ERR_DLOPEN_FAILED`，请用 Homebrew Node：`PATH=/opt/homebrew/bin:$PATH pnpm test`。

## 结构

```
src/
  core/        平台无关核心：类型 / 协议 / merge 引擎 / IndexedDB / 消毒 / 导出导入
  content/     内容脚本：bootstrap / 提取流水线 / 账号识别 / 适配器（每平台一个文件）
  background/  Service Worker：路由 / 串行队列 / 同步服务 / 角标
tests/
  unit/        指纹、diff、顺序号、合并、DB 往返、消毒、账号
  integration/ 夹具 HTML + 适配器解析 + 全链路（含验收 3 的 20+50→70）
```

## 当前状态（P0+P1 骨架完成）

- ✅ merge 引擎（平台 ID → 位置+角色+哈希 → 指纹 → 相似度 四级去重；Myers diff 对齐；小数序号插队）
- ✅ IndexedDB v1（含多账号字段）、迁移机制、唯一索引兜底
- ✅ HTML 消毒（XSS 防护 + 图片转占位链接）
- ✅ 账号指纹 / 脱敏 / default 桶兜底
- ✅ JSON 备份 + Markdown 导出 + 导入 merge 通道
- ✅ **五个平台适配器全部实测校正**（DeepSeek/Claude/Kimi/Grok 2026-10-31，ChatGPT 2026-11-02）
- ✅ 开发夹具适配器 + 5 份夹具 HTML（集成测试跑通全链路）
- ✅ P2 归档 UI：弹窗（状态/开关/手动同步）+ 归档页（列表/详情/搜索/导出 Markdown/JSON/导入/清空）
- ⏳ P3 ✅ 完成；后续 P4 加固（多标签页/草稿/配额）
- 📌 已知边界：DeepSeek 为虚拟列表，只归档滚动到可见的消息；账号菜单未渲染时落"默认账号"桶

## 硬性约束（CI 应检查）

- `content/adapters/` 之外不允许出现平台选择器或域名判断
- `core/` 不依赖 `chrome.*`
- 全库禁止 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`（"零上传"）
