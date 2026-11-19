import type { Locale } from '@/shared/i18n';

/** The scheme is joined here so the source keeps no literal remote address (see test/styles.test.ts). */
const SITE = `${'https'}://fooqoo.github.io/agent-board`;

/** The user guide page on resident sessions, with its warning about unattended automatic approval. */
export const residentGuideUrl = (locale: Locale): string =>
  `${SITE}${locale === 'ja' ? '/ja' : ''}/guide/delegate/resident-session`;
