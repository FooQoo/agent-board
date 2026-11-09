# リリースノート

Agent Boardの公開版ごとの変更点です。新しい版から順に並べています。各版のダウンロードは、[GitHub Release](https://github.com/FooQoo/agent-board/releases)にあります。

## v1.1.0

SafariやiPadでの表示の修正と、カードを追加する前に分け方を確認するSkillを含む版です。

### 変更点

- **依頼をタスクに分けます。** 1枚のタスクに収まらない作業を頼むと、エージェントがタスク・順番・エピックを提案し、あなたが「はい」と答えたときだけボードに追加するようになりました。詳しくは[依頼をタスクに分ける](./guide/automation/agents.md#依頼をタスクに分ける)をご覧ください。

### 不具合修正

- サイドパネルを開いている間もボードが自動更新されるようにしました。
- SafariやiPadでダイアログが横にずれる問題を直しました。
- ボードのページ全体が縦にスクロールしないようにしました。
- CLIで作った直後のプロジェクトが「Project not found」になる問題を直しました。
- モバイルモニターで回答した質問が、一瞬「取り下げられました」と表示される問題を直しました。

### 互換性に影響する変更

ありません。

### 必要な更新操作

コマンドを更新します。

```sh
brew upgrade fooqoo/tap/agboard
```

この版ではSkillが変わります。`agboard update`を実行して、導入済みのSkillを更新してください。Hookは変わりません。更新後は、新しいSkillを読み込ませるため、エージェントのセッションを新しく始めてください。

## v1.0.0

Agent Boardは、Claude CodeやCodexとタスク・進捗・判断を共有するローカルの作業ボードです。初回の公開版では、macOSへのHomebrewによる導入と、案内に沿ったエージェント連携の設定を提供します。

この版には2つの提供段階が混在します。ボード、タスク、判断依頼、エピック、エージェントが使うCLI、`connect`と`update`、初回の案内は一般提供（GA）です。ドキュメント、タスクの受け取り、モバイルモニターはパブリックプレビューで、今後の版で動作が変わる可能性があります。各段階の意味と現在の制約は[機能の提供段階](./guide/feature-stages.md)をご覧ください。GAは、不具合がないことや、今後も変更しないことを約束するものではありません。

### 変更点

- **Homebrewで導入できます。** `brew install fooqoo/tap/agboard`で、Web UIを含む署名済みのビルド済みコマンドをインストールします。Agent Boardをソースからビルドする必要はありません。
- **エージェントと連携できます。** `agboard connect`が、設定するエージェントと配置先を尋ね、Claude Code・Codex・両方のSkillとHookを導入します。書き込む前にすべての変更を表示し、変更するファイルはバックアップし、あなたが編集した内容は上書きしません。
- **対象外のフォルダではHookが静かに終わります。** プロジェクトに紐付いていないフォルダでGlobal Hookが動いても、何も出力せずに正常終了し、エージェントは作業を続けられます。
- **SkillとHookを更新できます。** `agboard update`が、導入済みのSkillとHookをコマンドの版にそろえます。通常のコマンドも、導入済みのものが古いときは知らせます。
- **スマートフォンから回答できます。** モバイルモニターは、ngrokとパスコードで接続します。（パブリックプレビュー）

macOS 15以降のApple SiliconまたはIntel Macが必要です。Agent Board本体はMITライセンスです。同梱する第三者のコンポーネントには、`THIRD_PARTY_NOTICES.txt`に記載したそれぞれのライセンスが適用されます。

### 不具合修正

初回の公開版のため、以前の公開版に対する修正はありません。

### 互換性に影響する変更

ありません。壊れる対象となる以前の公開版がありません。

### 必要な更新操作

新規に導入する場合、更新の操作は不要です。

```sh
brew install fooqoo/tap/agboard
cd my-project
agboard project create "My project"
agboard connect
agboard serve
```

以降の版では、`brew upgrade fooqoo/tap/agboard`でコマンドを更新します。SkillやHookが変わる版では、`agboard update`を実行し、変更されたHookをエージェントの`/hooks`で確認してください。詳しくは[インストールと起動](./guide/getting-started.md)と[エージェントとの連携](./guide/automation/agents.md)をご覧ください。
