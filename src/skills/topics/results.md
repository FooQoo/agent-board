# Deliver results while you work

The requester often reads the board on a phone, from a notification, and opens the chat only for the backstory. Give them something to look at early, so they do not have to come back to the chat to ask whether it is done.

## Deliver the first thing the requester can look at

As soon as the first thing the requester could look at is ready, record it as an intermediate result, even if the rest is unfinished. Use the unit the requester would look at, not a log of what you did:

- a video task: the first-draft video or its first seconds
- a UI task: a capture of the screen, taken from the running app
- a document or analysis task: the first readable version or the headline finding

```sh
agboard --project "<name>" result add <id> --title "First draft video" --summary "The first 30 seconds are viewable. The rest is still in progress." --link https://drive.example.com/draft.mp4 --file draft-frame.png --actor ai
agboard --project "<name>" result add <id> --summary "Top page on a phone width. Spacing is still being tuned." --file top.png --actor ai
agboard --project "<name>" result add <id> --summary "All 12 screens of the mock, in walk-through order." --file 01.png --file 02.png --file 03.png --actor ai
```

Give every result a short `--title` (at most 80 characters, one line): the heading the requester sees and the line a periodic summary lists, such as "First draft video" or "Top page on a phone". Without it the first sentence of the summary is used, cut to 80 characters, so a title is worth giving when that sentence would read badly as a heading. Write the summary so that it stands alone on a phone: what can be seen, and what is still missing. `--file` takes an image the board shows on the phone. When one delivery has several images (all the screens of a mock, before and after), put them on one result by repeating `--file` (up to 20, shown in the order given) instead of recording one result per image. `--link` takes where the main artifact lives: the board stores the text and serves no file behind it, so a local path such as `./out/draft.mp4` opens only on this PC. When the requester should open the artifact from a phone, link an address they can reach, and otherwise attach a capture with `--file` and say in the summary where the full artifact is. Recording a result changes no lane or run state and adds one history entry, so keep working; do not stop, wait for a reply, or ask whether the result is good enough. If no decision is needed, the next step is the next piece of work. Deliver again when the next viewable step is ready; each delivery gets the next version number, and repeating the same one is safe (`created: false`). The default key comes from the summary, the link text, and the image, not from the file a link points to: when you deliver a changed artifact under the same link and summary, pass a new `--key` (for example `draft-2`), and reuse that key when you retry the same delivery.

When the work is finished and verified, deliver the finished result with `--final`, then complete the conditions as usual (see the work loop in `agboard skills`). A final result does not move the task to Done by itself.

Automatic Done can complete a task before you write the final result. The progress table (and the hook) then lists it in `finalResultMissing` as `{id, title, taskPath}`, also while all its conditions are met but it is not yet Done. Record `result add <id> --final` for each listed task, with a PR link, a capture, or the verified outcome; `result add --final` is accepted on a Done task that has no final result, and the entry disappears afterwards. A Done task still refuses every other agent change, including a progress result. Do not stop other work for it.

## A result needs no reply

A result is a notification, not a question. Feedback on it is optional. Do not phrase it as a request ("let me know", "is this OK?") and do not block on it: a person who has nothing to say leaves the work to continue, and one who does can send a request or a message later.

## When a choice is needed, ask with `message ask`

Section 7 of the main instructions (`agboard skills`) decides when to call the user: unclear intent, a preference or value, an action that cannot be undone, or growing scope. When one applies, put the concrete question on the board with `message ask`; otherwise decide, record the decision in history, and keep working. Deliver the result first if it helps the user decide, then ask, with the choices and your recommendation:

```sh
agboard --project "<name>" message ask --actor ai --task <id> --questions-json - --json <<'JSON'
{"questions":[{"body":"The draft video is on the task (version 2). Which opening do you want?","choices":[{"id":"short","label":"5-second logo, then the demo"},{"id":"long","label":"15-second story, then the demo"}],"recommendedChoiceId":"short"}]}
JSON
```

Contrast the two:

| Situation | Do this | Do not do this |
| --- | --- | --- |
| The first draft is ready and you can keep improving it without input | `result add` with a summary and the link; keep working | Ask "How does it look?" and wait |
| Two openings are both plausible and the choice changes the work | `result add` if it helps, then `message ask` with the choices and a recommendation | Pick silently, or put the question inside the result summary |
| The work finished and is verified | `result add --final`, then the remaining completion conditions | Ending without a deliverable the requester can open |

When the choice is visual (two mocks, a screenshot, a layout), attach the images to the question with `images` and show them in its `body` as `![description](attachments/<file name>)`. Do not send only a local link: the user may be on a phone where it does not open.

Keep the question out of the result summary: only `message ask` is tracked as pending, answered, or withdrawn, and shown as a decision on the board. How to wait for the answer follows section 7 of the main instructions.
