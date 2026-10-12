# TASK.md and PLAN.md format

The completion conditions of a card (TASK.md) or an epic (PLAN.md) are in a YAML frontmatter at the top of the file. The board reads them. The body after the frontmatter is free Markdown, and no heading is required.

Start from [assets/TASK.md](../assets/TASK.md) or [assets/PLAN.md](../assets/PLAN.md).

## The frontmatter

```markdown
---
acceptance:
  - id: AC-1
    text: The setup guide covers the supported installation steps.
    done: false
---
```

- `acceptance`: a list. Each item has three keys and no others:
  - `id`: `AC-` followed by a positive number without a leading zero. Unique in the file.
  - `text`: one to 2,000 characters after trimming. Write it so that it can be verified.
  - `done`: `true` or `false`.
- Other keys in the frontmatter are kept when the board writes the file.
- A file without a frontmatter has no conditions.

If the frontmatter cannot be read, the board reports the file, the item, and the reason as a problem. The card then shows no progress and its whole text is the body. Fix the file by hand; the board does not rewrite it.

## Rules

- Set `done: true` only after the verification succeeded. Record the result and the evidence in the body, for example in the execution log.
- Add a condition with the next free number. Do not renumber the items.
- An agent can move a card to Done only when every condition is `done: true`. The board refuses the move and names the unmet IDs (`acceptance_unmet`). A person can always move a card.
- Keep results and notes in the body, not in the frontmatter.

## Earlier files

A file written in the earlier form, with Japanese headings (`## 作業内容`, `## 完了条件と確認結果`) and `- [ ] AC-n.` lines, has no frontmatter. The board reads it as a body with no conditions. Do not convert it unless the user asks.
