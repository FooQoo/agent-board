import { MarkdownSections } from './components/markdown/MarkdownSections';
import { MarkdownView } from './components/markdown/MarkdownView';

const DETAIL = `## 目的・責務

skan initでボードの保存領域を作る。保存先が既にあれば、変更しない。

## 受け入れ条件

- [x] 新しいデータ領域にボードを作れる
- [x] 既存のボードは変更しない
- [ ] 保存先に書けないときはエラーにする

## 手順

1. 保存先があるかを確かめる
2. なければボードを作る
3. 作成した結果を表示する

## 検証

1. 初回の実行でボードができる
2. 2回目の実行では何も変わらない
`;

function preview(origin: string): string {
  return `## 目的・責務

CLIの通常コマンドで対象を毎回明示させ、プロジェクトの作成・一覧・改名・削除だけを対象を省略せずに扱えるようにする。

## 画像

![図: 対象を明示して実行する流れ](${origin}/__mock/sample.svg)
![図: 切り替えの流れ(表示できません)](relative/path.png)

## 受け入れ条件

- [x] AC-1 同じカード番号のA・Bが混ざらない
- [x] AC-2 対象の省略を拒否する
- [ ] AC-3 同名の作成・改名を拒否する
- [ ] AC-4 削除は端末の確認が必要

## 検証計画

| シナリオ | 期待値 | AC |
|---|---|---|
| 対象の省略 | 終了コード2・invalid_argument | AC-2 |
| 同名の作成 | project_name_exists | AC-3 |
`;
}

/**
 * Sample-data mode only (`?view=markdown`): the Markdown parts alone, in the narrow column
 * width (`&width=narrow`, default) or the wide preview width (`&width=wide`).
 */
export function MarkdownSample({ search }: { search: string }) {
  const wide = new URLSearchParams(search).get('width') === 'wide';
  return (
    <div
      id="markdown-sample"
      style={{
        width: wide ? 696 : 304,
        padding: wide ? '20px 28px' : 0,
        margin: wide ? 0 : '24px 28px',
        background: 'var(--r-surface)',
        boxSizing: 'border-box',
      }}
    >
      {wide ? (
        <MarkdownView source={preview(window.location.origin)} variant="wide" />
      ) : (
        <MarkdownSections source={DETAIL} />
      )}
    </div>
  );
}
