import { describe, expect, it } from 'vitest';
import { SAMPLE_IMAGE_URL } from './fixtures';

describe('synthetic image fixtures', () => {
  it('serves the sample image from the Story static folder', async () => {
    const response = await fetch(SAMPLE_IMAGE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
  });

  it('displays the sample image in the browser at its intrinsic size', async () => {
    const image = new Image();
    image.src = SAMPLE_IMAGE_URL;
    await image.decode();
    expect(image.naturalWidth).toBe(96);
    expect(image.naturalHeight).toBe(64);
  });
});
