# PLAN.md and TASK.md format

Agent Board validates the headings and the completion conditions of every `PLAN.md` and `TASK.md`. A body that fails is rejected by `add`, `edit`, and `epic edit`, and a directly edited file that fails is reported in the snapshot's `problems`.

Write the content in the language the user speaks with you, as described in `SKILL.md`. The required headings and the three result labels are fixed identifiers; write them in English exactly as shown and never translate them. Replace the template placeholders and the initial values (`Not verified`, `Not recorded`, `Not checked`) with text in the user's language.

## Templates

Start from these templates instead of the minimal ones the CLI writes:

- `assets/PLAN.md` for an epic plan
- `assets/TASK.md` for a task plan

Copy a template to a temporary file, fill it in, and pass it with `--plan-file` or `--desc-file`. Remove the HTML comments once the sections are written. You may add `###` subsections and other Markdown under the required headings, but keep every required heading.

## Required headings

| File | Heading | What it holds |
| --- | --- | --- |
| `PLAN.md` | `## Goal` | Why the epic exists and the outcome it should produce. |
| `PLAN.md` | `## Scope` | What is in and out of scope. |
| `PLAN.md` | `## Completion conditions` | The epic-level conditions and their results. |
| `PLAN.md` | `## Approach` | The task cards, their order and dependencies, how the whole is verified, and decisions that changed the plan. |
| `TASK.md` | `## Work` | The task's purpose, details, files to change, and verification plan. |
| `TASK.md` | `## Completion conditions` | The task's conditions and their results. |
| `TASK.md` | `## Execution log` | Entries appended in time order. Never rewrite earlier entries. |

Files created by earlier versions may use Japanese headings and labels (`## 作業内容`, `## 完了条件と確認結果`, `## 実行記録`, `## 目的`, `## 対象範囲`, `## 進め方`, `確認結果:`, `根拠:`, `調整役の確認:`). They remain valid. When you edit such a file, keep its existing headings; do not rename them.

## Completion conditions

Each condition is a task-list item with a unique positive `AC` number and exactly these three indented result lines:

```markdown
- [ ] AC-1. The setup guide covers the supported installation steps.
  - Result: Not verified
  - Evidence: Not recorded
  - Coordinator check: Not checked
```

- `Result`: the verification outcome, for example `Passed: 12 tests`.
- `Evidence`: how it was verified: the command or steps, the result, and references to evidence (`evidence:<id>`, `attachment:<id>`, a commit, or a repository-relative path).
- `Coordinator check`: confirmation by the agent or person overseeing this work. When no one else was named for the work, you are the coordinator; re-check the evidence against the condition before you fill it in.

Rules:

- Write each condition so that it can be verified. Split a vague condition into several.
- Check an item (`- [x]`) only after its verification succeeded and all three lines are filled in. A checked item records that the condition was met.
- A card moves to `done` when every condition is checked. Do not move it while any condition remains unchecked.
- If a condition can no longer be met, or the user changes it, record the reason in `## Execution log` and update the condition. Never check an item that was not verified.
- The product does not judge whether a condition is met and never rewrites the body. Completion depends on you following these rules.
