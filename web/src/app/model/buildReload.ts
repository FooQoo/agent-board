import { pageBuildId } from '../../shared/lib/build/buildId';

/**
 * The page's scripts are cached by name, so a page stays on the build it loaded until it reloads.
 * The server's `ready` event names its current build; a page that loaded another build reloads to
 * pick up the new HTML, unless the user is in the middle of an edit or an answer.
 */

/** The build this tab last reloaded for. A second reload for the same build is never tried. */
const RELOADED_FOR = 'agboard-build-reload';

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the page should reload for the server's build `served`, recording the attempt. A page
 * without a build ID, or without session storage to stop a reload loop, never reloads.
 */
export function claimBuildReload(served: string, own: string | null = pageBuildId()): boolean {
  if (own === null) return false;
  const store = sessionStore();
  if (store === null) return false;
  try {
    if (own === served) {
      store.removeItem(RELOADED_FOR);
      return false;
    }
    if (store.getItem(RELOADED_FOR) === served) return false;
    store.setItem(RELOADED_FOR, served);
    return true;
  } catch {
    return false;
  }
}
