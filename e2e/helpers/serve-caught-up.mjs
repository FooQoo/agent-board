// Wait until a running serve shows the cards just written to its data directory.
//
// The serve answers the board from an index that its file watcher updates, so for a moment after a spec rewrites
// the files directly the serve still shows the cards of the previous test. A page opened in that moment loads the
// old board. `restoreProject` runs this script synchronously after it writes a fixture.
//
// Input on stdin: {"url", "project", "tasks": [{"id", "title", "taskStatus", "agentStatus", "updatedAt"}]}.
// Exits 0 once the serve's summary of `project` lists exactly those cards (and no epics), 1 after the deadline.

const input = JSON.parse(await new Promise((resolve) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (text += chunk));
  process.stdin.on('end', () => resolve(text));
}));
const base = input.url.replace(/\/$/, '');
const deadline = Date.now() + (input.timeoutMs ?? 15_000);
const key = (task) => `${task.id}|${task.title}|${task.taskStatus}|${task.agentStatus}|${Math.floor(Date.parse(task.updatedAt) / 1000)}`;
const want = input.tasks.map(key).sort().join('\n');
let last = 'no answer';

while (Date.now() < deadline) {
  try {
    const projects = await (await fetch(`${base}/api/projects`)).json();
    const project = projects.projects.find((candidate) => candidate.name === input.project);
    if (project) {
      const summary = await (await fetch(`${base}/api/projects/${project.id}/summary`)).json();
      const got = summary.tasks.map(key).sort().join('\n');
      if (got === want && summary.epics.length === 0) process.exit(0);
      last = `tasks:\n${got}\nepics: ${summary.epics.length}`;
    } else {
      last = `no project named ${input.project}`;
    }
  } catch (error) {
    last = String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
process.stderr.write(`the serve at ${base} did not show the restored ${input.project} board; last seen ${last}\n`);
process.exit(1);
