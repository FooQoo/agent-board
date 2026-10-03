import { removeHome, stopServe } from './helpers/skan';
import { state } from './helpers/state';

export default async function globalTeardown(): Promise<void> {
  await stopServe(state.serve);
  const home = process.env.SKAN_E2E_HOME;
  if (home) removeHome(home);
}
