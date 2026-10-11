import type { MonitorViewProps } from './contracts';

/** U1 placeholder: later monitor UoWs supply the designed read-only presentation. */
export function MonitorView({
  projects,
  scope,
  summary,
  pending,
  running,
  done,
  freshness,
  onScopeChange,
}: MonitorViewProps) {
  return (
    <main className="monitor-shell">
      <header>
        <h1>Agent Board Monitor</h1>
        <p>Read-only project monitor</p>
      </header>
      <label>
        Project
        <select
          value={scope}
          aria-label="Project"
          onChange={(event) => onScopeChange(event.currentTarget.value)}
        >
          <option value="all">All Projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <p role="status">{freshness.state}</p>
      <dl>
        <dt>Pending</dt>
        <dd>{summary?.pending ?? pending.length}</dd>
        <dt>Running</dt>
        <dd>{summary?.running ?? running.length}</dd>
        <dt>Done</dt>
        <dd>{summary?.done ?? done.length}</dd>
      </dl>
    </main>
  );
}
