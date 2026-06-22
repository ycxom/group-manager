# Group Manager

独立运行的 QQ 群管程序。通过 WebSocket 与 Bot 通讯，自动撤回违规消息、累计违规踢出成员，支持每个群独立规则配置，提供 Web 管理界面与多用户权限控制。

## 架构

```
┌─────────────────────────────────────┐
│           group-manager             │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │ 管理 WS  │    │  HTTP 管理    │  │
│  │  :8765   │    │  界面 :8766   │  │
│  └────┬─────┘    └───────────────┘  │
│       │                             │
│  ┌────▼─────────────────────────┐   │
│  │        核心逻辑 (recall.js)   │   │
│  │  关键词检测 / 违规计数 / 踢出  │   │
│  └────┬─────────────────────────┘   │
│       │                             │
│  ┌────▼─────┐    ┌───────────────┐  │
│  │ SQLite   │    │  OneBot 适配  │  │
│  │  数据库   │    │  (可选直连)   │  │
│  └──────────┘    └───────────────┘  │
└─────────────────────────────────────┘
         ▲
         │ WebSocket (管理协议)
         │
┌────────┴────────┐
│  Yunzai 桥接    │   或任意实现了管理协议的客户端
│  插件 / Bot     │
└─────────────────┘
```

## 功能特性

- **消息检测**：文本关键词、JSON 类型消息（QQ 收藏分享等）、合并转发消息内容扫描
- **累计违规**：每个群独立计数，达到上限自动撤回 + 踢出（所有监控群同步踢）
- **每群独立规则**：关键词、违规上限、启用状态均可按群配置；全局关键词对所有群生效
- **豁免用户**：指定 QQ 号跳过检测（全局或单群）
- **Web 管理界面**：浏览器操作群组、关键词、豁免用户、违规记录
- **多系统用户**：账户密码登录，`superadmin` 管理全部，`admin` 只能访问授权群
- **实时事件推送**：Web 界面通过 SSE 实时显示撤回/踢出事件
- **Bot 接入**：支持通过 Yunzai 桥接插件或直接 OneBot v11 WebSocket 接入

## 环境要求

- Node.js **18+**（使用 ESM 模块语法）
- 无需 Python / 编译工具（依赖均为纯 JS / WASM）

## 快速开始

```bash
cd group-manager
npm install       # 或 pnpm install
npm start
```

首次启动自动创建：
- `config.json`（静态配置，修改后需重启）
- `data/gm.sqlite`（运行时数据库，热更新）
- 默认超级管理员账户 `admin / admin`

打开 `http://localhost:8766`，使用 `admin / admin` 登录，**立即修改密码**。

### 开发模式（文件变更自动重启）

```bash
npm run dev
```

## 配置说明

`config.json` 在首次启动时自动生成，修改后需**重启**服务。

```jsonc
{
  "debug": false,          // true = 仅打印命中日志，不执行撤回/踢出

  // 以下字段仅用于旧版迁移，运行时数据由 SQLite 管理
  "recallKeywords": [],    // 迁移到 DB 后不再读取
  "whitelistGroups": [],
  "exemptUsers": [],

  "bot": {
    "url": "",             // OneBot WS 地址，留空则跳过直连 Bot
                           // 示例: "ws://127.0.0.1:3001"
    "token": "",           // OneBot 鉴权 token（可为空）
    "mode": "forward"      // "forward": 主动连接 Bot；"reverse": Bot 连接我们
  },
  "management": {
    "port": 8765,          // 管理 WebSocket 端口（供 Bot 适配器连接）
    "token": "change-this-token"  // 管理协议鉴权 token
  }
}
```

> Web 管理界面端口默认 `8766`，在 `src/http-server.js` 的 `uiPort` 或通过 `management.uiPort` 配置字段修改。

## Web 管理界面

访问 `http://localhost:8766`，支持所有界面操作通过浏览器完成。

### 权限说明

| 功能 | superadmin | admin |
|------|:----------:|:-----:|
| 添加 / 移除群组 | ✓ | — |
| 修改群配置（启用/违规上限） | ✓ | 仅授权群 |
| 全局关键词管理 | ✓ | — |
| 单群/组别关键词管理 | ✓ | 仅授权群/组别 |
| 全局/单群/组别豁免用户管理 | ✓ | 仅授权群/组别 |
| 违规记录查看 / 清除 | ✓（全部）| 仅授权群 |
| 组别管理（创建/删除/分配成员群） | ✓ | — |
| 系统用户管理 | ✓ | — |
| 分配群/组别访问权限 | ✓ | — |
| 修改自己的密码 / 用户名 | ✓ | ✓ |

### 页面说明

| 页面 | 说明 |
|------|------|
| **仪表板** | 群组总览、违规统计、实时事件日志 |
| **群组** | 添加/移除监控群，设置启用状态与违规上限，查看所属组别 |
| **关键词** | 管理触发撤回的关键词，支持全局 / 单群 / 组别三种作用域；每条可勾选「仅撤回」（命中只撤回不计违规），文字 / OCR / 二维码关键词均支持 |
| **豁免用户** | 指定 QQ 号跳过检测，支持全局 / 单群 / 组别三种作用域 |
| **违规记录** | 查看各群违规详情，手动清除记录 |
| **组别** | 管理组别，将群组归入组别，批量控制多群规则 |
| **系统用户** | 管理登录账户及其群/组别访问权限 |

## Bot 接入

### 方式一：Yunzai 桥接插件（推荐）

将 `yunzai-plugin/group-manager-bridge.js` 复制到 Yunzai 的 `plugins/` 目录，group-manager 与 Yunzai 均正常启动即可自动连接。

```bash
cp group-manager/yunzai-plugin/group-manager-bridge.js /path/to/Yunzai/plugins/
```

在文件顶部按需修改连接配置：

```js
const GM_WS_URL = 'ws://127.0.0.1:8765'   // group-manager 管理 WS 地址
const GM_TOKEN  = 'change-this-token'       // 与 config.json management.token 一致
```

桥接插件会：
- 将群消息转发给 group-manager 处理
- 预拉取合并转发消息内容（避免 group-manager 回调 Bot）
- 执行返回的操作（撤回消息 / 踢出成员）

### 方式二：OneBot v11 直连

在 `config.json` 的 `bot.url` 填写 OneBot WebSocket 地址（如 `ws://127.0.0.1:3001`），group-manager 会自动建立连接并监听群消息。

### 方式三：自定义客户端（管理 WS 协议）

连接 `ws://localhost:8765`，发送 JSON 消息。

**认证：**
```json
{ "cmd": "auth", "token": "change-this-token", "role": "bot" }
```

**消息上报：**
```json
{
  "cmd": "event.message",
  "_id": 1,
  "groupId": 123456,
  "userId": 654321,
  "senderRole": "member",
  "messageId": "abc123",
  "segments": [
    { "type": "text", "text": "消息内容" }
  ]
}
```

**返回值：**
```json
{ "ok": true, "_id": 1, "data": { "action": "recall", "messageId": "abc123" } }
```

`action` 可能值：`noop` / `recall` / `recall+kick`（此时附带 `kickGroups` 数组）

## 群内命令

Bot 接入后，群主或管理员可在群内发送以下命令：

| 命令 | 权限 | 说明 |
|------|:----:|------|
| `#gm keyword list` | 管理员/群主 | 查看本群有效关键词 |
| `#gm keyword add <词>` | 管理员/群主 | 添加关键词到本群（撤回并计违规） |
| `#gm keyword addonly <词>` | 管理员/群主 | 添加「仅撤回」关键词（命中只撤回，不计违规、不踢人） |
| `#gm keyword remove <词>` | 管理员/群主 | 删除本群关键词 |
| `#gm violations` | 管理员/群主 | 查看本群违规列表 |
| `#gm clear <QQ号>` | 群主 | 清除指定成员的违规记录 |
| `#gm exempt add <QQ号>` | 群主 | 添加豁免成员 |
| `#gm exempt remove <QQ号>` | 群主 | 移除豁免成员 |

## CLI 参数

### 重置管理员密码

```bash
node index.js --reset-admin <新密码>
# 新密码留空则重置为 admin
node index.js --reset-admin
```

执行后立即退出，不启动服务。

## 目录结构

```
group-manager/
├── index.js                  # 入口：组装并启动所有服务
├── config.json               # 静态配置（自动生成）
├── data/
│   └── gm.sqlite             # SQLite 数据库（自动生成）
├── src/
│   ├── db.js                 # SQLite 数据层（sql.js WASM）
│   ├── recall.js             # 核心检测逻辑（协议无关）
│   ├── config.js             # 静态配置管理
│   ├── mgmt-server.js        # 管理 WebSocket 服务（Bot 适配器接入）
│   ├── http-server.js        # Web 管理界面 HTTP 服务
│   ├── adapters/
│   │   └── onebot.js         # OneBot v11 直连适配器
│   └── ui/
│       └── index.html        # 单文件 Web 管理界面
├── yunzai-plugin/
│   └── group-manager-bridge.js  # Yunzai 桥接插件（复制到 Yunzai plugins/ 使用）
├── test-client.js            # WS 管理协议测试套件
└── package.json
```

## 数据库表结构

| 表 | 说明 |
|----|------|
| `groups` | 监控群组，含启用状态与违规上限 |
| `keywords` | 关键词，`group_id=0` 为全局，`group_id>0` 为单群 |
| `exempt_users` | 豁免用户，`group_id=0` 为全局，`group_id>0` 为单群 |
| `violations` | 违规计数，按 `(user_id, group_id)` 主键 |
| `users` | 系统登录账户 |
| `user_groups` | 系统用户与群的直接授权关联 |
| `categories` | 组别，多个群可归入同一组别 |
| `group_category` | 群与组别的多对多关联 |
| `category_keywords` | 组别级关键词，对组内所有群生效 |
| `category_exempt_users` | 组别级豁免用户，对组内所有群生效 |
| `user_categories` | 系统用户与组别的授权关联 |
