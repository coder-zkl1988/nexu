# Tabby

Tabby 是一个桌面优先的 AI 工作空间，用于在本机运行 AI 伙伴、连接聊天渠道，并从一个应用中控制设备工作流。

<p align="center">
  <a href="README.md">English</a> |
  简体中文 |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="site/media/tabby-desktop-screenshot.png" width="100%" alt="Tabby 桌面端界面" />
</p>

Tabby 面向个人和小团队，提供一个实用的本地控制平面：创建 AI 伙伴、连接聊天渠道、使用自己的模型服务商，并把运行状态保留在自己的电脑上。

## 下载

当前公开版本可在 GitHub Releases 下载：

- macOS Apple Silicon: [tabby-0.3.0-arm64.dmg](../../releases/download/v0.3.0/tabby-0.3.0-arm64.dmg)
- 发布页: [Tabby 0.3.0](../../releases/tag/v0.3.0)

当前版本暂未提供 Intel macOS 和 Windows 安装包。

## Tabby 能做什么

Tabby 提供本地桌面环境，用于：

- 创建和管理 AI 伙伴
- 将 AI 伙伴连接到微信、飞书、Slack、Discord 等聊天渠道
- 从桌面应用运行基于 OpenClaw 的本地运行时服务
- 管理模型服务商，包括 OAuth 登录和自备 API Key
- 安装并使用技能和专家模板
- 控制 Android 设备并查看实时设备镜像
- 运行定时和自动化任务

## 功能亮点

### 本地优先的桌面运行时

Tabby 从桌面应用中运行 controller、Web UI 和 OpenClaw 运行时。用户配置和运行状态存储在本地，让你的数据和自动化流程保持在自己的控制范围内。

### AI 伙伴与专家

为不同角色创建自定义 AI 伙伴，安装专家模板，并通过结构化工作区文件为每个伙伴提供清晰的身份和任务上下文。

### 聊天渠道集成

把 AI 伙伴接入你已经在用的 IM 工具。Tabby 提供渠道配置和机器人绑定流程，让每个渠道都能路由到合适的 AI 伙伴。

### 设备控制

Tabby 支持 Android 设备控制和实时镜像。你可以连接设备、查看实时画面、下发任务，并在桌面面板中查看任务历史。

### 技能与自动化

安装技能、同步运行时配置，并安排周期性自动化任务。Tabby 的目标是把一次性的聊天命令推进到可重复的 Agent 工作流。

## 系统要求

- macOS 12 或更高版本
- 当前 `arm64` 版本需要 Apple Silicon Mac
- 本地开发需要 pnpm 10+ 和 Node.js 22+

## 安装

1. 从发布页下载 `tabby-0.3.0-arm64.dmg`。
2. 打开 DMG。
3. 将 `Tabby.app` 拖入 Applications。
4. 从 Applications 启动 Tabby。

macOS 安装包已使用 Developer ID 签名，经过 Apple 公证，并在发布前完成 stapler 票据装订。

## 开发

安装依赖：

```bash
pnpm install
```

启动本地桌面栈：

```bash
pnpm dev start
```

停止本地桌面栈：

```bash
pnpm dev stop
```

运行常用检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

构建 macOS Apple Silicon 生产安装包：

```bash
pnpm dist:mac:production:arm64
```

## 仓库结构

```text
apps/
  controller/   本地控制平面和 HTTP API
  desktop/      Electron 桌面壳和打包运行时
  web/          React 控制台
packages/
  shared/       共享 schemas 和类型
  slimclaw/     OpenClaw 运行时打包契约
tests/          集成与回归测试
specs/          产品、运行时和架构说明
```

## 发布说明

最新发布说明见 [GitHub Releases](../../releases) 页面。

## 致谢

当前仓库的基础源自 Nexu 项目；感谢 Nexu 所做的基础工作，让 Tabby 能在此基础上继续前进。

## 许可证

本项目基于 [MIT License](LICENSE) 发布。
