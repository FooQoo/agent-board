# New task template

Start the `TASK.md` of a new task from this template. The frontmatter is input: Agent Board generates the first history entry.

```markdown
---
acceptance:
  - id: AC-1
    text: (Describe a condition that can be verified.)
    done: false
# Creation input: Agent Board generates the initial history entry.
# Stored entries have exactly at (UTC YYYY-MM-DDTHH:MM:SSZ) and reason (content).
# at uses whole seconds only; timezone offsets and fractional seconds are rejected.
history: []
---

## Background

(Why this task exists and what it builds on.)

## What to do

(The change to make, in a few sentences or a short list.)

## Approach

(How you will do it, and any decision that shapes it.)

## Verification results

(Add concise verified acceptance results and artifact references here after verification.)
```

The body headings above are recommended, not required: a body without them is still valid. Write the headings in the language of the board, per the language rule of the skill. Automatically record progress and all operation history only in the history frontmatter; do not add an execution-history section to the body.
