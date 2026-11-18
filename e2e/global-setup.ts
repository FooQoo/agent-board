import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { repoRoot } from './helpers/agboard';
import { buildPhoneBackend } from './helpers/phone-entrance.mjs';

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

// Builds once for the whole run. Each worker then starts its own serve and data area (helpers/fixtures.ts).
export default async function globalSetup(): Promise<void> {
  // CI builds once in another job and hands the shards the finished binaries, because the Playwright image
  // has no Rust toolchain. AGBOARD_E2E_BINARY and AGBOARD_E2E_PHONE_BACKEND name them.
  if (process.env.AGBOARD_E2E_PREBUILT === '1') {
    for (const name of ['AGBOARD_E2E_BINARY', 'AGBOARD_E2E_PHONE_BACKEND']) {
      const file = process.env[name];
      if (!file || !existsSync(file)) throw new Error(`AGBOARD_E2E_PREBUILT is set, but ${name} does not name an existing file`);
    }
    return;
  }
  // The binary embeds web/dist, so the screen is built first.
  run('corepack', ['pnpm', '--dir', 'web', 'build']);
  run('cargo', ['build']);
  // Building the phone backend links target/debug/agboard again, so it happens here, before the workers use it.
  process.env.AGBOARD_E2E_PHONE_BACKEND = buildPhoneBackend();
}
