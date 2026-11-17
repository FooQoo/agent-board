import { describe, expect, it } from 'vitest';
import { messageAttachmentUrl, resolveMessageImage } from './messageAttachment';

const project = 'a'.repeat(32);

describe('messageAttachmentUrl', () => {
  it('builds the route of a message image', () => {
    expect(messageAttachmentUrl(project, 'Q-3', 'screen.png')).toBe(
      `/api/projects/${project}/messages/Q-3/attachments/screen.png`,
    );
  });

  it('encodes the message ID and the name', () => {
    expect(messageAttachmentUrl(project, 'Q-3', 'a b/../c.png')).toBe(
      `/api/projects/${project}/messages/Q-3/attachments/a%20b%2F..%2Fc.png`,
    );
  });
});

describe('resolveMessageImage', () => {
  it('resolves attachments/<name> from a body', () => {
    expect(resolveMessageImage(project, 'Q-3', 'attachments/screen.png')).toBe(
      `/api/projects/${project}/messages/Q-3/attachments/screen.png`,
    );
  });

  it.each([
    `${'https:'}//e.test/a.png`,
    '/etc/passwd',
    '../attachments/a.png',
    'attachments/',
    'attachments/../QA.md',
    'attachments/sub/a.png',
    'screen.png',
  ])('leaves %s unresolved', (reference) => {
    expect(resolveMessageImage(project, 'Q-3', reference)).toBeNull();
  });
});
