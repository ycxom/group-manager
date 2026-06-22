# 群管理后台 · Web UI (Next.js)

基于 Next.js 16 (App Router) + Tailwind v4 + shadcn 风格组件 重写的现代管理界面。
**纯前端**：所有数据通过 Next 的 `rewrites` 代理到现有 Node 后端（`../index.js` 的 `http-server.js`），
后端逻辑、鉴权、SSE 全部保持不变。

## 架构

```text
浏览器 ──> Next (默认 3000) ──rewrites──> 后端 http-server (默认 8766)
                                            /api/*  /events  /login /logout /me
```

代理目标由环境变量 `GM_BACKEND` 控制，默认为 `http://127.0.0.1:8766`，见 `next.config.ts`。

## 运行

先启动后端（在 `group-manager/` 目录）：

```bash
node index.js      # 监听 8766（UI）与 8765（Bot WS）
```

再启动前端（在 `group-manager/web/` 目录）：

```bash
npm run dev        # 开发模式 http://localhost:3000
# 或生产模式
npm run build && npm run start
```

后端端口不是 8766 时：

```bash
GM_BACKEND=http://127.0.0.1:9000 npm run dev
```

## 已迁移页面（本轮）

- **登录** — 复用后端 `/login`，HttpOnly cookie 会话经代理透传
- **仪表板** — 统计卡片 + 监控群组表
- **关键词** — 文字 / OCR / 二维码三类，全局 / 组别 / 独立群组作用域；
  支持「仅撤回」开关（命中只撤回不计违规），以及列表内一键切换处置方式
- **实时事件日志** — 宽屏右侧 SSE 面板（撤回 / 踢出 / 扫描 / 信息）

侧边栏其余条目（群组 / 豁免 / 违规 / 组别 / 图片规则 / 用户）标记「待迁移」，
后端接口已就绪，逐步补齐即可。

## 目录

```text
src/
  app/
    layout.tsx          # AuthProvider + AppShell + Toaster
    page.tsx            # 仪表板
    keywords/page.tsx   # 关键词管理
    globals.css         # 深色主题 token（shadcn 命名）
  components/
    auth-provider.tsx   # 会话 + groups/categories 上下文
    app-shell.tsx       # 侧边栏 / 顶栏 / 内容 / 日志
    login-form.tsx
    event-log.tsx       # SSE 实时日志
    ui/                 # button/card/input/label/badge/table/switch/select/sonner
  lib/
    api.ts              # 类型化 POST 客户端 + 鉴权
    utils.ts            # cn()
```
