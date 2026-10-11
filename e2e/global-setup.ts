import { spawnSync } from 'node:child_process';
import { mainPort, mainProject, makeHome, repoRoot, resetBoard, startServe } from './helpers/agboard';
import { state } from './helpers/state';

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

export default async function globalSetup(): Promise<void> {
  // The binary embeds web/dist, so the screen is built first.
  run('pnpm', ['--dir', 'web', 'build']);
  run('cargo', ['build']);

  const home = makeHome('main');
  process.env.AGBOARD_E2E_HOME = home;
  resetBoard(mainProject, home);
  state.serve = await startServe(mainPort, home);
}
