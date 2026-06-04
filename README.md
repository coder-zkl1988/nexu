# Tabby

Tabby is a desktop-first AI workspace that helps you run local AI agents, connect them to chat channels, and control device workflows from one application.

It is built for individuals and small teams who want a practical local control plane: create AI partners, connect channels, use your own model providers, and keep runtime state on your own machine.

## Download

The current public release is available from GitHub Releases:

- macOS Apple Silicon: [tabby-0.3.0-arm64.dmg](../../releases/download/v0.3.0/tabby-0.3.0-arm64.dmg)
- Release page: [Tabby 0.3.0](../../releases/tag/v0.3.0)

Intel macOS and Windows packages are not included in the current release.

## What Tabby Does

Tabby provides a local desktop environment for:

- Creating and managing AI partners
- Connecting AI partners to chat channels such as WeChat, Feishu, Slack, and Discord
- Running local OpenClaw-based runtime services from the desktop app
- Managing model providers, including OAuth-based and bring-your-own-key flows
- Installing and using skills and expert templates
- Controlling Android devices and viewing real-time device mirrors
- Running scheduled and automated tasks

## Highlights

### Local-First Desktop Runtime

Tabby runs the controller, web UI, and OpenClaw runtime from the desktop app. User configuration and runtime state are stored locally, so your data and automation workflows stay under your control.

### AI Partners and Experts

Create custom AI partners for different roles, install expert templates, and use structured workspace files to give each partner a clear identity and task context.

### Chat Channel Integration

Connect AI partners to IM channels and make them available from the tools you already use. Tabby includes channel setup flows and bot binding so each channel can be routed to the right AI partner.

### Device Control

Tabby includes Android device control and real-time mirroring support. You can connect devices, view live screens, dispatch tasks, and inspect task history from the desktop dashboard.

### Skills and Automation

Install skills, sync runtime configuration, and schedule recurring automation tasks. Tabby is designed to move from one-off chat commands toward repeatable agent workflows.

## System Requirements

- macOS 12 or later
- Apple Silicon Mac for the current `arm64` release
- pnpm 10+ and Node.js 22+ for local development

## Installation

1. Download `tabby-0.3.0-arm64.dmg` from the release page.
2. Open the DMG.
3. Drag `Tabby.app` into Applications.
4. Launch Tabby from Applications.

The macOS package is signed with Developer ID, notarized by Apple, and stapled before release.

## Development

Install dependencies:

```bash
pnpm install
```

Start the local desktop stack:

```bash
pnpm dev start
```

Stop the local desktop stack:

```bash
pnpm dev stop
```

Run common checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Build the macOS Apple Silicon production package:

```bash
pnpm dist:mac:production:arm64
```

## Repository Layout

```text
apps/
  controller/   Local control plane and HTTP API
  desktop/      Electron desktop shell and packaged runtime
  web/          React dashboard
packages/
  shared/       Shared schemas and types
  slimclaw/     OpenClaw runtime packaging contract
tests/          Integration and regression tests
specs/          Product, runtime, and architecture notes
```

## Release Notes

See the latest release notes on the [GitHub Releases](../../releases) page.

## Acknowledgements

This repository is based on foundational work from the Nexu project; thank you to Nexu for the core groundwork that made Tabby possible.

## License

This project is released under the [MIT License](LICENSE).
