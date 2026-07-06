# DDBOT-WSa WebUI

DDBOT-WSa 的 Web 管理面板。通过浏览器管理 Bot 进程、订阅、配置、日志，无需手动编辑文件或记忆命令。

## 功能

| 模块 | 功能 |
|------|------|
| **仪表盘** | Bot 进程启停 / OneBot 连接状态 / 系统信息 / 开机自启 |
| **适配器** | QQ 协议配置 (OneBot v11 / Satori) / WS 正向反向切换 / Telegram 转发配置 |
| **日志** | 实时流式日志 / 按级别过滤 / 自动滚动 |
| **订阅管理** | 增删改查订阅 / 按平台统计 / 对接 Bot 内置 Admin API |
| **设置** | 分类表单配置 / 原始 YAML 编辑器 / 快捷设置 |

## 目录结构

运行后自动生成：

```
根目录/
├── webui.exe           ← WebUI (打包后) 或 server.js (源码运行)
├── config.json         ← WebUI 配置 (可执行文件路径)
├── log/                ← WebUI 运行日志
└── data/               ← Bot 所有文件
    ├── ddbot.exe       ← Bot 可执行文件
    ├── application.yaml
    ├── .lsp.db
    ├── logs/
    └── qq-logs/
```

## 快速开始

### 方式一：源码运行

```bash
cd ddbot-wsa-webui
npm install
npm start
# 访问 http://localhost:9630
```

需要 Node.js >= 18。Bot 可执行文件放在 `data/` 目录下。

### 方式二：打包为单文件

```bash
npm run build
# 输出 dist/ddbot-wsa-webui.exe (约 54MB)
```

将 `dist/ddbot-wsa-webui.exe` 复制到目标目录，双击运行，无需安装 Node.js。

## 首次使用

1. 启动 WebUI
2. 在「设置」→「Bot」中配置可执行文件路径（如果 Bot 不在默认的 `data/` 目录）
3. 在「仪表盘」点击「启动」
4. Bot 启动后 WebUI 自动开启管理后台并对接实时数据

## 开机自启

在仪表盘「开机自启」卡片点击切换，无需管理员权限：

| 平台 | 实现方式 |
|------|----------|
| Windows | 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |
| Linux | systemd 用户服务 `~/.config/systemd/user/` |
| macOS | LaunchAgent `~/Library/LaunchAgents/` |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WEBUI_PORT` | `9630` | WebUI 端口 |
| `DDBOT_DIR` | 自动检测 | Bot 目录，默认为 `data/` |

## Bot Admin API 对接

WebUI 启动 Bot 时会自动在 `application.yaml` 中开启 `admin.enable: true`。Bot 运行后，WebUI 每 5 秒轮询以下端点获取实时数据：

| WebUI | Bot Admin API | 用途 |
|-------|---------------|------|
| 连接状态 | `GET /api/v1/onebot/status` | OneBot 真实在线状态 |
| 订阅列表 | `GET /api/v1/subs/list` | Bot 内存中的订阅数据 |
| 订阅统计 | `GET /api/v1/subs/summary` | 按平台统计数量 |
| 添加订阅 | `POST /api/v1/subs/add` | 直接写入 Bot |
| 删除订阅 | `POST /api/v1/subs/remove` | 直接从 Bot 删除 |
| 修改配置 | `POST /api/admin/sub/config` | 修改订阅类型 |

Bot Admin API 不可用时自动回退到本地 JSON 文件。

## 构建

```bash
npm run build       # 打包当前平台
```

使用 [caxa](https://github.com/nickersoft/caxa) 将完整项目（含 Node.js 运行时）打包为单文件可执行程序。

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 HTML/CSS/JS (无框架)
- **实时通信**: WebSocket (Socket.IO)
- **打包**: caxa (Node.js SEA)

## License

MIT
