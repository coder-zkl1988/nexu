# Tabby

Tabby は、ローカルで AI パートナーを実行し、チャットチャネルへ接続し、デバイス操作ワークフローをひとつのアプリから扱うためのデスクトップファーストな AI ワークスペースです。

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  日本語 |
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="site/media/tabby-desktop-screenshot.png" width="100%" alt="Tabby デスクトップ画面" />
</p>

Tabby は、実用的なローカルコントロールプレーンを求める個人や小規模チーム向けです。AI パートナーの作成、チャットチャネルの接続、任意のモデルプロバイダーの利用、そして実行状態のローカル保存をまとめて扱えます。

## ダウンロード

現在の公開リリースは GitHub Releases から入手できます。

- macOS Apple Silicon: [tabby-0.3.0-arm64.dmg](../../releases/download/v0.3.0/tabby-0.3.0-arm64.dmg)
- リリースページ: [Tabby 0.3.0](../../releases/tag/v0.3.0)

現在のリリースには Intel macOS 版と Windows 版は含まれていません。

## Tabby でできること

Tabby は、次のためのローカルデスクトップ環境を提供します。

- AI パートナーの作成と管理
- WeChat、Feishu、Slack、Discord などのチャットチャネルへの AI パートナー接続
- デスクトップアプリからの OpenClaw ベースのローカルランタイムサービス実行
- OAuth と bring-your-own-key を含むモデルプロバイダー管理
- スキルとエキスパートテンプレートのインストールと利用
- Android デバイス制御とリアルタイムミラー表示
- スケジュール済みタスクと自動化タスクの実行

## ハイライト

### ローカルファーストのデスクトップランタイム

Tabby は controller、Web UI、OpenClaw ランタイムをデスクトップアプリから実行します。ユーザー設定とランタイム状態はローカルに保存されるため、データと自動化ワークフローを自分の管理下に置けます。

### AI パートナーとエキスパート

役割ごとにカスタム AI パートナーを作成し、エキスパートテンプレートをインストールし、構造化されたワークスペースファイルで各パートナーに明確な identity とタスク文脈を与えられます。

### チャットチャネル連携

普段使っている IM ツールに AI パートナーを接続できます。Tabby にはチャネル設定と bot バインディングのフローがあり、各チャネルを適切な AI パートナーへルーティングできます。

### デバイス制御

Tabby は Android デバイス制御とリアルタイムミラー表示をサポートします。デバイス接続、ライブ画面確認、タスク送信、タスク履歴の確認をデスクトップダッシュボードから行えます。

### スキルと自動化

スキルをインストールし、ランタイム設定を同期し、定期的な自動化タスクを設定できます。Tabby は一度きりのチャットコマンドから、再利用可能な Agent ワークフローへ進むために設計されています。

## システム要件

- macOS 12 以降
- 現在の `arm64` リリースには Apple Silicon Mac が必要
- ローカル開発には pnpm 10+ と Node.js 22+ が必要

## インストール

1. リリースページから `tabby-0.3.0-arm64.dmg` をダウンロードします。
2. DMG を開きます。
3. `Tabby.app` を Applications にドラッグします。
4. Applications から Tabby を起動します。

macOS パッケージは Developer ID で署名され、Apple による notarization を受け、リリース前に stapler でチケットが付与されています。

## 開発

依存関係をインストールします。

```bash
pnpm install
```

ローカルデスクトップスタックを起動します。

```bash
pnpm dev start
```

ローカルデスクトップスタックを停止します。

```bash
pnpm dev stop
```

一般的なチェックを実行します。

```bash
pnpm typecheck
pnpm lint
pnpm test
```

macOS Apple Silicon の production パッケージをビルドします。

```bash
pnpm dist:mac:production:arm64
```

## リポジトリ構成

```text
apps/
  controller/   ローカルコントロールプレーンと HTTP API
  desktop/      Electron デスクトップシェルと同梱ランタイム
  web/          React ダッシュボード
packages/
  shared/       共有 schema と型
  slimclaw/     OpenClaw ランタイムパッケージング契約
tests/          統合テストと回帰テスト
specs/          製品、ランタイム、アーキテクチャのメモ
```

## リリースノート

最新のリリースノートは [GitHub Releases](../../releases) ページをご覧ください。

## 謝辞

このリポジトリは Nexu プロジェクトの基礎的な成果をもとにしています。Tabby の土台となる作業を行った Nexu に感謝します。

## ライセンス

このプロジェクトは [MIT License](LICENSE) のもとで公開されています。
