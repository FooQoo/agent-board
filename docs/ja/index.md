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
    title: "人とAIが、\n同じボードで仕事を進める。"
    lead: エージェントが何をしていて、何に答えを待っているか。タスク・質問・受入条件をひとつのボードで共有し、PCでもスマホでも返答できます。
    install: brew install fooqoo/tap/agboard
    primary: { text: はじめる, link: /ja/guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
    meta: macOS · Claude Code / Codex · MIT License
    videoLabel: デモ動画。エージェントがタスクに着手して質問し、タスクの回答欄から返答すると作業を再開して、完了まで進む
    questionAlt: エージェントの質問と2つの選択肢が表示された、待機中のタスク
  problem:
    eyebrow: なぜ共有ボードか
    title: エージェントの状態を、ターミナルの外へ。
    lead: 長い仕事を任せると、進み具合も質問もターミナルの中に埋もれます。ボードに出せば、人もAIも同じものを見ながら進められます。
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
    title: 質問して、答えて、また進む。
    lead: エージェントは止まる前に質問を残し、あなたの回答で再開します。受入条件がすべてそろうと、タスクは自動で完了へ移ります。
    actors: { ai: AI, human: 人, auto: 自動 }
    lanes:
      - title: 未着手 → 進行中
        steps:
          - { actor: ai, title: 着手, text: タスクを進行中へ移し、作業を始めます。 }
      - title: 進行中（質問と回答）
        steps:
          - { actor: ai, title: 質問, text: 選択肢を添えて、あなたの判断を求めます。 }
          - { actor: human, title: 回答, text: PCかスマホで、選択肢を選びます。 }
          - { actor: ai, title: 再開, text: 回答を読み、続きの作業を進めます。 }
      - title: 完了
        steps:
          - { actor: auto, title: 完了, text: 受入条件がそろうと、自動で完了へ移ります。 }
  features:
    eyebrow: 機能
    title: ひとつのボードに、仕事の流れをまとめる。
    previewLabel: パブリックプレビュー
    items:
      - image: board
        title: ボード
        text: 未着手・進行中・完了の3列に、稼働中・待機中の状態を重ねて表示します。質問への回答も、タスクの上でそのまま行えます。
        link: { text: ボードの使い方, link: /ja/guide/use/board }
        alt: タスク内の回答欄、受入条件の達成数、詳細パネルを表示したPCボード
      - image: epic
        title: エピックと進行表
        text: エピックでタスクの順序を決めると、進行表が、いま進められる作業をエージェントに返します。
        link: { text: エピックと進行表, link: /ja/guide/use/epics }
        alt: タスクの進行表とMarkdown本文を持つエピック編集画面
      - image: mobile
        title: スマホで確認
        text: 席を離れていても、スマホのモニターから状況を確かめ、質問に答えられます。
        link: { text: モバイルモニター, link: /ja/guide/operations/mobile-monitor }
        preview: /ja/guide/feature-stages#mobile-monitor
        alts:
          - 待機中のタスクと「質問に回答する」ボタンが見える、モバイルモニターのカードの一覧
          - 選択肢を選び、送信ボタンが出ているモバイルモニターの質問
          - モバイルモニターの下部のドロワーで、受入条件のタブを開いたタスク
      - image: docs
        title: プロジェクトのドキュメント
        text: プロジェクトのdocs/にある設計書や仕様を、ボードから開いて読めます。
        link: { text: プロジェクトのドキュメント, link: /ja/guide/use/docs }
        preview: /ja/guide/feature-stages#docs
        alt: ファイル一覧とMarkdownの文書を表示した「ドキュメント」ダイアログ
  agents:
    eyebrow: 連携
    title: いつものエージェントから、そのまま。
    lead: agboard connectが、Claude CodeとCodexにSkillとHookを対話で導入します。エージェントは進行表を読み、タスクを追加し、質問して回答を待ちます。
    supportedLabel: 対応エージェント
    supported:
      - { text: Claude Code, link: https://www.claude.com/product/claude-code }
      - { text: Codex, link: https://developers.openai.com/codex }
    trademark: Claude CodeはAnthropic、CodexはOpenAIの製品で、各名称は各社の商標です。Agent Boardは独立したプロジェクトで、両社と提携しておらず、推奨も受けていません。
    command: agboard connect
    terminal:
      label: ターミナルで
      caption: いくつかの質問に答えるだけで、SkillとHookが入ります。
      lines:
        - { kind: command, text: $ agboard connect }
        - { kind: frame, text: "┌  agboard connect" }
        - { kind: question, text: "◇  Select agents to connect" }
        - { kind: answer, text: "│  Claude Code, Codex" }
        - { kind: question, text: "◇  Skill scope" }
        - { kind: answer, text: "│  Global" }
        - { kind: question, text: "◇  Hook scope" }
        - { kind: answer, text: "│  Global" }
        - { kind: question, text: "◇  Apply these changes?" }
        - { kind: answer, text: "│  Yes" }
        - { kind: result, text: "◆  Claude Code: configured" }
        - { kind: result, text: "◆  Codex: configured" }
        - { kind: frame, text: "└  Setup finished." }
    link: { text: エージェントとの連携, link: /ja/guide/automation/agents }
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
      - { title: プロジェクトとエージェントをつなぐ, commands: ['agboard project create "My project"', agboard connect] }
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
