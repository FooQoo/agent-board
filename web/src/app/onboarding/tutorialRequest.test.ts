import { describe, expect, it, vi } from 'vitest';
import { onTutorialRequest, requestTutorial } from './tutorialRequest';

describe('tutorial request', () => {
  it('keeps a request made before the guide listens and hands it to the first listener', () => {
    requestTutorial();
    const listener = vi.fn();
    const stop = onTutorialRequest(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();

    const later = vi.fn();
    const stopLater = onTutorialRequest(later);
    expect(later).not.toHaveBeenCalled();
    requestTutorial();
    expect(later).toHaveBeenCalledTimes(1);
    stopLater();
  });
});
