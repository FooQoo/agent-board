---
layout: home
title: Agent Board
markdownStyles: false

landing:
  lanes: [未着手, 進行中, 完了]
  copy:
    label: コマンドをコピー
    done: コピーしました
  hero:
    title: "頼むだけで、\n計画から完了まで\nAIが進めてくれる。"
    lead: Agent Boardは、AIエージェントのための仕事のハーネスです。依頼を受入条件つきの計画に直し、一度の承認で始め、止まってあなたに聞くのは必要なときだけ。見守るのも答えるのも、PCでもスマホでもチャットでもできます。
    install: brew install fooqoo/tap/agboard
    primary: { text: はじめる, link: /ja/guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
    meta: macOS · Claude Code / Codex · MIT License
    videoLabel: デモ動画。エージェントがタスクに着手して質問し、タスクの回答欄から返答すると作業を再開して、完了まで進む
  problem:
    eyebrow: なぜ仕事のハーネスか
    title: いまは、任せても目が離せない。
    lead: 計画を自分で書き、ログに埋もれた質問を拾い、本当に終わったかを確かめる。計画・質問・条件をひとつの場所にまとめれば、仕事を頼んだら、エージェントが呼ぶまで離れていられます。
    terminal:
      label: ターミナルの中だけ
      caption: 質問は、流れていくログの途中に埋もれてしまう。
      lines:
        - { text: Read docs/plan.md }
        - { text: Edit src/pages/pricing.tsx }
        - { text: +42 −8, sub: true }
        - { text: Bash pnpm test }
        - { text: ✓ 128 passed, sub: true }
        - { text: "公開方法を決めてください: 1) 先にプレビュー 2) 一般公開", question: true }
        - { text: Edit src/pages/index.tsx }
        - { text: +12 −3, sub: true }
        - { text: Bash pnpm build }
        - { text: built in 4.2s, sub: true }
        - { text: Edit docs/release-notes.md }
    board:
      label: ボードで共有
      caption: 待機中のタスクと質問が、列の中ですぐ目に入る。
      alt: 進行中の列で待機中のタスクに、エージェントの質問と選択肢が表示されたボード
    questions:
      - { title: 何が止まっている？, text: 待機中のタスクは色が変わり、列の中で目立ちます。 }
      - { title: 何に答えればいい？, text: 質問と選択肢が、タスクの上にそのまま出ます。 }
      - { title: どこまで終わった？, text: 受入条件の達成数と履歴が、タスクごとに残ります。 }
  loop:
    eyebrow: しくみ
    title: 頼んで、一度承認したら、あとは任せる。
    lead: やりたいことを伝えると、エージェントがボードに計画を置きます。開始を一度承認すれば、順に作業が進みます。止まってあなたに聞くのは必要なときだけで、確かめた条件がそろったタスクは、自動で完了へ移ります。
    actors: { ai: AI, human: あなた, auto: 自動 }
    lanes:
      - title: 要望 → 計画
        steps:
          - { actor: human, title: 要望, text: やりたいことを、普通の言葉でエージェントに伝えます。 }
          - { actor: ai, title: 計画, text: 受入条件つきの仮の計画をボードに置き、計画の質問をします。 }
      - title: 承認
        steps:
          - { actor: human, title: 承認, text: 計画の質問に答え、開始を一度だけ承認します。 }
      - title: 作業
        steps:
          - { actor: ai, title: 作業, text: 順にタスクを進めます。止まるのは、意図が分からない・好みで決まる・取り返しがつかない・範囲が広がる、のときだけです。 }
      - title: 完了
        steps:
          - { actor: auto, title: 完了, text: 確かめた条件がすべてそろうと、自動で完了へ移ります。 }
  features:
    eyebrow: 仕事を映す窓
    title: どこからでも、見守って介入する。
    previewLabel: パブリックプレビュー
    items:
      - image: board
        title: ボード
        text: 仕事が未着手・進行中・完了と進むのを見守れます。エージェントを止めずにカードへ介入でき、質問への回答も、タスクの上でそのまま行えます。
        link: { text: ボードの使い方, link: /ja/guide/watch/board }
        alt: タスク内の回答欄、受入条件の達成数、詳細パネルを表示したPCボード
      - image: epic
        title: エピックと進行表
        text: エピックが計画とタスクの順序を持ち、進行表が、いま進められる作業をエージェントに返します。計画がどこまで進んだかも見えます。
        link: { text: エピックと進行表, link: /ja/guide/watch/epics }
        alt: タスクの進行表とMarkdown本文を持つエピック編集画面
      - image: mobile
        title: スマホで確認
        text: 席を離れていても、スマホのモニターから仕事を見守り、エージェントの質問に答えられます。
        link: { text: モバイルモニター, link: /ja/guide/watch/mobile-monitor }
        preview: /ja/guide/feature-stages#mobile-monitor
        alts:
          - 待機中のタスクと「質問に回答する」ボタンが見える、モバイルモニターのカードの一覧
          - 選択肢を選び、送信ボタンが出ているモバイルモニターの質問
          - モバイルモニターの下部のドロワーで、受入条件のタブを開いたタスク
      - image: docs
        title: プロジェクトのドキュメント
        text: プロジェクトのdocs/にある設計書や仕様を、ボードから開いて読めます。
        link: { text: プロジェクトのドキュメント, link: /ja/guide/watch/docs }
        preview: /ja/guide/feature-stages#docs
        alt: ファイル一覧とMarkdownの文書を表示した「ドキュメント」ダイアログ
  agents:
    eyebrow: 連携
    title: いつものエージェントから、そのまま。
    lead: agboard setupが、Claude CodeとCodexにSkillとHookを含むAgent Boardプラグインを導入します。同じ仕事のモデルを、どちらでも使えます。エージェントは進行表を読み、仕事を計画し、質問して回答を待ちます。
    supportedLabel: 対応エージェント
    supported:
      - { text: Claude Code, link: https://www.claude.com/product/claude-code }
      - { text: Codex, link: https://developers.openai.com/codex }
    trademark: Claude CodeはAnthropic、CodexはOpenAIの製品で、各名称は各社の商標です。Agent Boardは独立したプロジェクトで、両社と提携しておらず、推奨も受けていません。
    command: agboard setup
    terminal:
      label: ターミナルで
      caption: エージェントを選んで確認するだけで、プラグインが入ります。
      lines:
        - { kind: command, text: $ agboard setup }
        - { kind: frame, text: "┌  agboard setup" }
        - { kind: question, text: "◇  Which agent do you use with Agent Board?" }
        - { kind: answer, text: "│  Both" }
        - { kind: question, text: "◇  Apply these changes? …" }
        - { kind: answer, text: "│  Yes" }
        - { kind: result, text: "◆  Codex: updated" }
        - { kind: result, text: "◆  Claude Code: updated" }
    link: { text: エージェントとの連携, link: /ja/guide/delegate/agents }
  trust:
    title: 手元で動き、データはあなたのもの。
    items:
      - { title: ローカルで動く, text: サーバーは127.0.0.1だけで待ち受けます。 }
      - { title: Markdownで残る, text: タスクはTASK.md、エピックはEPIC.md。直接編集もできます。 }
      - { title: OSS（MIT）, text: ソースコードをGitHubで公開しています。 }
      - { title: アカウント不要, text: 登録もクラウドサービスも要りません。 }
  start:
    eyebrow: はじめ方
    title: 3つの手順で、ボードが開きます。
    lead: macOS 15以降とHomebrew、Claude CodeかCodexがあれば始められます。
    steps:
      - { title: インストールする, commands: [brew install fooqoo/tap/agboard] }
      - { title: エージェントとプロジェクトを設定する, commands: [agboard setup, 'agboard project create "My project"'] }
      - { title: ボードを開く, commands: [agboard serve] }
    note: "バージョン1.0.0には、ドキュメントやモバイルモニターなど、パブリックプレビューの機能が含まれます。詳しくは"
    noteLinks:
      - { text: 機能の提供段階, link: /ja/guide/feature-stages }
    noteJoin: と
    noteEnd: を参照してください。
    primary: { text: インストールと起動を読む, link: /ja/guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
---

<LandingPage />
