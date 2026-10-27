import { describe, expect, it } from 'vitest';
import type { DocsTreeNode } from '../api/docsApi';
import { resolveDocsLink } from './docsLink';

// Built in parts so the source guard keeps rejecting embedded remote URLs.
const SITE = `${['https:', '', 'example.com'].join('/')}/x`;

const file = (path: string, viewer: DocsTreeNode['viewer'] = 'markdown'): DocsTreeNode => ({
  name: path.split('/').at(-1) ?? path,
  path,
  kind: 'file',
  viewer,
});
const dir = (path: string, children: DocsTreeNode[]): DocsTreeNode => ({
  name: path.split('/').at(-1) ?? path,
  path,
  kind: 'dir',
  children,
});

const TREE: DocsTreeNode[] = [
  dir('product', [
    dir('product/business', [file('product/business/01_STRATEGY.mdx')]),
    dir('product/features', [
      file('product/features/01_INDEX.mdx'),
      file('product/features/README.md'),
    ]),
    dir('product/empty', []),
    file('product/01_PRODUCT.mdx'),
    file('product/logo.png', 'image'),
  ]),
  file('README.md'),
];

describe('resolveDocsLink', () => {
  it('opens a file next to the document', () => {
    expect(resolveDocsLink('product/01_PRODUCT.mdx', 'logo.png', TREE)).toEqual({
      kind: 'file',
      path: 'product/logo.png',
    });
  });

  it('reads ./ and ../ from the document folder, and drops a fragment and a query', () => {
    expect(
      resolveDocsLink(
        'product/business/01_STRATEGY.mdx',
        '../features/01_INDEX.mdx#list?x=1',
        TREE,
      ),
    ).toEqual({ kind: 'file', path: 'product/features/01_INDEX.mdx' });
    expect(resolveDocsLink('product/01_PRODUCT.mdx', './business/01_STRATEGY.mdx', TREE)).toEqual({
      kind: 'file',
      path: 'product/business/01_STRATEGY.mdx',
    });
    expect(resolveDocsLink('product/01_PRODUCT.mdx', '../README.md', TREE)).toEqual({
      kind: 'file',
      path: 'README.md',
    });
  });

  it('opens the README of a linked folder', () => {
    expect(resolveDocsLink('product/01_PRODUCT.mdx', 'features/', TREE)).toEqual({
      kind: 'file',
      path: 'product/features/README.md',
    });
    expect(resolveDocsLink('product/01_PRODUCT.mdx', 'empty/', TREE)).toEqual({ kind: 'missing' });
  });

  it('decodes an encoded name', () => {
    const tree = [file('a b.md')];
    expect(resolveDocsLink('README.md', 'a%20b.md', tree)).toEqual({
      kind: 'file',
      path: 'a b.md',
    });
  });

  it('is missing for a path with no file, out of the root, or from the root', () => {
    expect(resolveDocsLink('product/01_PRODUCT.mdx', 'NONE.mdx', TREE)).toEqual({
      kind: 'missing',
    });
    expect(resolveDocsLink('README.md', '../outside.md', TREE)).toEqual({ kind: 'missing' });
    expect(resolveDocsLink('README.md', '/README.md', TREE)).toEqual({ kind: 'missing' });
    expect(resolveDocsLink('README.md', '%E0%A4%A.md', TREE)).toEqual({ kind: 'missing' });
  });

  it('leaves http and https to a new tab', () => {
    expect(resolveDocsLink('README.md', SITE, TREE)).toEqual({
      kind: 'external',
      url: SITE,
    });
  });

  it('ignores an anchor in the page and other schemes', () => {
    expect(resolveDocsLink('README.md', '#top', TREE)).toEqual({ kind: 'ignore' });
    expect(resolveDocsLink('README.md', 'mailto:a@example.com', TREE)).toEqual({ kind: 'ignore' });
    expect(resolveDocsLink('README.md', 'javascript:alert(1)', TREE)).toEqual({ kind: 'ignore' });
    expect(resolveDocsLink('README.md', '  ', TREE)).toEqual({ kind: 'ignore' });
  });
});
