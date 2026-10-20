---
layout: home
title: Agent Board

hero:
  name: Agent Board
  tagline: ユーザーとAIが一緒に作業を進める共有ボード。
  image:
    light: /logo.png
    dark: /logo-white.png
    alt: Agent Boardのロゴ
  actions:
    - theme: brand
      text: はじめる
      link: /ja/guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/FooQoo/agent-board

features:
  - icon:
      src: /icons/kanban.svg
      alt: ''
      width: 28
      height: 28
    title: 人とAIが同じボードで作業を進める
    details: 未着手・進行中・完了の3列で進捗を管理し、稼働中・待機中の状態でAIの動きを確認できます。PCやスマホから、タスクに表示された質問に回答できます。
  - icon:
      src: /icons/list-ordered.svg
      alt: ''
      width: 28
      height: 28
    title: 進行表と自動完了で、AIの管理操作を減らす
    details: エピックでタスクの進行順を決め、agboard progressで今進められる作業を取得できます。自動完了の対象となるAI担当タスクは、すべての受入条件を満たすと完了の列へ移ります。
  - icon:
      src: /icons/file-text.svg
      alt: ''
      width: 28
      height: 28
    title: 計画・結果・証跡をローカルのMarkdownで管理する
    details: エピックの詳細はEPIC.md、タスクはTASK.mdに保存し、証跡も隣に置きます。ファイルの直接編集とMarkdownエディターの両方に対応し、アカウントやクラウドサービスは不要です。
---

<script setup>
import { withBase } from 'vitepress'
</script>

## 動きを見る

<video class="demo-video" :src="withBase('/videos/demo.ja.mp4')" :poster="withBase('/videos/demo.ja.jpg')" autoplay muted loop playsinline></video>

タスクへの着手から完了までの流れを紹介します。エージェントが質問すると、ユーザーはタスクの回答欄から返答します。エージェントは回答を受けて作業を再開し、すべての受入条件を満たすと、タスクが自動で完了の列へ移ります。

## ボード

エージェントに長時間の作業を任せると、進捗や、回答を待っている質問を把握しにくくなります。Agent Boardでは、ユーザーとエージェントが同じボードと履歴を確認しながら、質問・回答・作業の再開を繰り返して進められます。

![タスク内の回答欄、受入条件の達成数、詳細の4タブを表示したPCボード](../images/board.ja.png){.screenshot}

## エピックと進行表

エピックでタスクの順序を決め、進行表で次に進められる作業を確認します。

![タスクの進行表とMarkdown本文を持つエピック編集画面](../images/epic.ja.png){.screenshot}

## スマホで使う

タスクに表示された質問へ回答したり、画面下部から開く詳細パネル（ドロワー）で本文・受入条件・履歴・エピックを確認したりできます。

![本文・受入条件・履歴・エピックの4タブを持つモバイルの下部ドロワー](../images/mobile.ja.png){.screenshot .screenshot--narrow}

## はじめる

Agent Boardは手元のマシンで動き、アカウントもホスティングも要りません。まずボードを起動し、エージェントと連携する設定を行います。

<div class="home-steps">

1. **ボードを起動する**

   プロジェクトを作成して`agboard serve`を実行し、ブラウザでボードを開きます。[インストールと起動](./guide/getting-started)

2. **エージェントに作業を登録させる**

   Claude CodeやCodexをHookで連携します。エージェントは進行表を読み、タスクを追加します。[エージェントとの連携](./guide/automation/agents)

3. **質問に回答する**

   エージェントが質問したら、PCやスマホで、タスクに表示された選択肢を選んで回答します。[判断依頼](./guide/use/decisions)

</div>

```sh
git clone https://github.com/FooQoo/agent-board.git
cd agent-board
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

<div class="home-cta">
  <a class="home-cta__button home-cta__button--brand" :href="withBase('/ja/guide/getting-started')">はじめる</a>
  <a class="home-cta__button" href="https://github.com/FooQoo/agent-board">GitHub</a>
</div>
