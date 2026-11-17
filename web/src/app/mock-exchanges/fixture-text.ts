/** The image the questions and requests show: a synthetic file of the Storybook static folder. */
export const ATTACHMENT_ID = '0123456789abcdef0123456789abcdef';

/** The text of the synthetic data, in the language of the Story. */
export function fixtureText(ja: boolean) {
  return ja
    ? {
        q12: '既存のユーザーデータを残しますか',
        q12Body: `## 既存のユーザーデータの扱い

ログインの作り直しで、保存済みのパスワードのハッシュ形式が変わります。切り替え方を決めてください。

![いまの画面](attachment:${ATTACHMENT_ID})

残す場合は、初回ログイン時に新しい形式へ変換します。消す場合は、全員にパスワードの再設定をお願いします。`,
        keep: '残す(初回ログイン時に変換)',
        drop: '消す(再設定をお願いする)',
        q13: 'ログインに使う認証方式はどれにしますか',
        q13Body:
          '## 認証方式\n\nメールとパスワードのほかに、外部アカウントでのログインも足しますか。',
        q13a: 'メールとパスワードだけ',
        q13b: '外部アカウントも足す',
        r14: 'ログイン画面に、パスワードを忘れたときの導線を足して。',
        r14Body: `ログイン画面に、パスワードを忘れたときの導線を足してください。

- ログインボタンの下に「パスワードを忘れた方」のリンク
- 押すとメールアドレスの入力画面へ

![いまの画面](attachment:${ATTACHMENT_ID})`,
        r11: 'ダークモードで表の罫線が見えにくい',
        r11Body: 'ダークモードで、表の罫線が背景に溶けて見えにくいです。',
        askDraft:
          '## パスワードを忘れたとき\n\nログイン画面に、パスワードを忘れた人が戻れる導線を足してください。\n\n![login.png](attachment:a5a00000000000000000000000000001)',
        q9: 'リリースノートは英語だけでよいですか',
        goal: 'ログイン画面を作り直し、パスワードを忘れたときも自分で復旧できるようにする。',
        goalMore:
          '対象はメールとパスワードのログインです。画面、再設定メール、セッションの保存を順に整えます。',
        epicName: 'ログインの改善',
        t21: 'ログイン画面を作り直す',
        t22: 'パスワード再設定のメールを送る',
        t23: 'セッションの保存先を決める',
        t24: '手動で動作を確かめる',
        t25: 'ログインの手順をドキュメントに書く',
        addedA: 'ログイン失敗の回数を制限する',
        addedB: '制限の画面文言を確認する',
        d31: 'ヘルプページの誤字を直す',
        d32: '検索の候補を3件にする',
        l14: 'Windows ビルドを用意する',
        l15: 'セットアップガイドを書く',
        l16: '空のボードの表示を見直す',
        l17: 'レビューを依頼する',
        l18: 'リリースノートを確認する',
        l41: '設定画面を作る',
        l42: 'API のリファクタリング',
        l43: 'ダークモードを整える',
        l44: 'ロゴを差し替える',
      }
    : {
        q12: 'Keep the existing user data?',
        q12Body: `## What to do with existing user data

Rebuilding the login changes the hash format of stored passwords. Decide how to switch over.

![Current screen](attachment:${ATTACHMENT_ID})

If you keep it, each account is converted at its next login. If you drop it, everyone is asked to reset their password.`,
        keep: 'Keep (convert at next login)',
        drop: 'Drop (ask for a reset)',
        q13: 'Which sign-in method should the login use?',
        q13Body:
          '## Sign-in method\n\nBesides email and password, should the login also accept an outside account?',
        q13a: 'Email and password only',
        q13b: 'Add outside accounts too',
        r14: 'Add a way back to the login screen for people who forgot their password.',
        r14Body: `Please add a way back on the login screen for people who forgot their password.

- A "Forgot your password?" link under the login button
- It opens a screen to enter an email address

![Current screen](attachment:${ATTACHMENT_ID})`,
        r11: 'Table borders are hard to see in dark mode',
        r11Body: 'In dark mode the table borders blend into the background.',
        askDraft:
          '## Forgotten password\n\nAdd a way back on the login screen for people who forgot their password.\n\n![login.png](attachment:a5a00000000000000000000000000001)',
        q9: 'Are English-only release notes enough?',
        goal: 'Rebuild the login screen so people can recover a forgotten password by themselves.',
        goalMore:
          'It covers email and password sign-in. The screen, the reset email and session storage are done in that order.',
        epicName: 'Improve login',
        t21: 'Rebuild the login screen',
        t22: 'Send the password reset email',
        t23: 'Decide where sessions are stored',
        t24: 'Check the behavior by hand',
        t25: 'Document the login steps',
        addedA: 'Limit the number of failed logins',
        addedB: 'Review the wording of the limit screen',
        d31: 'Fix a typo on the help page',
        d32: 'Show three search suggestions',
        l14: 'Prepare the Windows build',
        l15: 'Write the setup guide',
        l16: 'Refine the empty board',
        l17: 'Request a review',
        l18: 'Check the release notes',
        l41: 'Build the settings screen',
        l42: 'Refactor the API',
        l43: 'Polish dark mode',
        l44: 'Replace the logo',
      };
}
