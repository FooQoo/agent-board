import type { DocsTreeNode } from '../../src/features/docs/ui/shell/DocsFileTree';

const file = (name: string, parent: string): DocsTreeNode => ({
  name,
  path: parent === '' ? name : `${parent}/${name}`,
  kind: 'file',
});

/** The tree of the approved mock: three folders, two of them nested. */
export const docsTree: DocsTreeNode[] = [
  {
    name: 'Strategy',
    path: 'Strategy',
    kind: 'dir',
    children: [file('Vision.md', 'Strategy'), file('Target Users.md', 'Strategy')],
  },
  {
    name: 'Product',
    path: 'Product',
    kind: 'dir',
    children: [
      file('Overview.md', 'Product'),
      file('Tasks.md', 'Product'),
      file('Mobile Monitor.md', 'Product'),
    ],
  },
  {
    name: 'Engineering',
    path: 'Engineering',
    kind: 'dir',
    children: [
      {
        name: 'Architecture',
        path: 'Engineering/Architecture',
        kind: 'dir',
        children: [
          file('Overview.md', 'Engineering/Architecture'),
          file('Notifications.md', 'Engineering/Architecture'),
        ],
      },
      {
        name: 'Features',
        path: 'Engineering/Features',
        kind: 'dir',
        children: [
          file('Tasks.md', 'Engineering/Features'),
          file('Decisions.md', 'Engineering/Features'),
        ],
      },
    ],
  },
];

/** The folder the Docs of a project live in, as the empty state shows it. */
export const docsRootPath = '~/.agent-board/docs/<project-id>/';
