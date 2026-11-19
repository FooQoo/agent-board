# Deliver results while you work

The requester often reads the board on a phone, from a notification, and opens the chat only for the backstory. Give them something to look at early, so they do not have to come back to the chat to ask whether it is done.

## Deliver the first thing the requester can look at

As soon as the first thing the requester could look at is ready, record it as an intermediate result, even if the rest is unfinished. Use the unit the requester would look at, not a log of what you did:

- a video task: the first-draft video or its first seconds
- a UI task: a capture of the screen, taken from the running app
- a document or analysis task: the first readable version or the headline finding

```sh
agboard --project "<name>" result add <id> --summary "The first 30 seconds are viewable. The rest is still in progress." --link https://drive.example.com/draft.mp4 --file draft-frame.png --actor ai
agboard --project "<name>" result add <id> --summary "Top page on a phone width. Spacing is still being tuned." --file top.png --actor ai
```

Write the summary so that it stands alone on a phone: what can be seen, and what is still missing. `--file` takes an image the board shows on the phone. `--link` takes where the main artifact lives: the board stores the text and serves no file behind it, so a local path such as `./out/draft.mp4` opens only on this PC. When the requester should open the artifact from a phone, link an address they can reach, and otherwise attach a capture with `--file` and say in the summary where the full artifact is. Recording a result changes no lane or run state and adds one history entry, so keep working; do not stop, wait for a reply, or ask whether the result is good enough. If no decision is needed, the next step is the next piece of work. Deliver again when the next viewable step is ready; each delivery gets the next version number, and repeating the same one is safe (`created: false`). The default key comes from the summary, the link text, and the image, not from the file a link points to: when you deliver a changed artifact under the same link and summary, pass a new `--key` (for example `draft-2`), and reuse that key when you retry the same delivery.

When the work is finished and verified, deliver the finished result with `--final`, then complete the conditions as usual (see the work loop in `agboard skills`). A final result does not move the task to Done by itself.

## A result needs no reply

A result is a notification, not a question. Feedback on it is optional. Do not phrase it as a request ("let me know", "is this OK?") and do not block on it: a person who has nothing to say leaves the work to continue, and one who does can send a request or a message later.

## When a choice is needed, ask with `message ask`

Only when the work cannot go on without the user's choice, or a wrong guess would be costly to undo, put the concrete question on the existing questions (section 7 of the main instructions, `agboard skills`). Deliver the result first if it helps the user decide, then ask, with the choices and your recommendation:

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

Keep the question out of the result summary: only `message ask` is tracked as pending, answered, or withdrawn, and shown as a decision on the board. How to wait for the answer follows section 7 of the main instructions.
