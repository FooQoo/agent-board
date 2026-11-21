import { describe, expect, it } from 'vitest';
import { attachedTaskIds, splitAttachmentLine, withAttachedTasks } from './attachLine';

describe('attachedTaskIds', () => {
  it('reads the ids of a last line made only of task references', () => {
    expect(attachedTaskIds('Fix it\n#552 #651')).toEqual([552, 651]);
  });

  it('reads a request that is only the line', () => {
    expect(attachedTaskIds('#7')).toEqual([7]);
  });

  it('ignores a reference in the middle of the text', () => {
    expect(attachedTaskIds('See #552 for context\nand more')).toEqual([]);
    expect(attachedTaskIds('#552\nand more text')).toEqual([]);
  });

  it('does not count a last line with other words or glued tokens', () => {
    expect(attachedTaskIds('Fix\n#552 please')).toEqual([]);
    expect(attachedTaskIds('Fix\n#552#651')).toEqual([]);
    expect(attachedTaskIds('Fix\n#abc')).toEqual([]);
    expect(attachedTaskIds('Fix\n#')).toEqual([]);
  });

  it('tolerates trailing whitespace and repeated ids', () => {
    expect(attachedTaskIds('Fix\n#552  #651 \n\n')).toEqual([552, 651]);
    expect(attachedTaskIds('Fix\n#5 #5 #6')).toEqual([5, 6]);
  });

  it('has no ids in an empty text', () => {
    expect(attachedTaskIds('')).toEqual([]);
  });
});

describe('splitAttachmentLine', () => {
  it('keeps the whole text as the body when there is no line', () => {
    expect(splitAttachmentLine('Fix\nit ')).toEqual({ body: 'Fix\nit ', ids: [] });
  });
});

describe('withAttachedTasks', () => {
  it('adds the line after the text', () => {
    expect(withAttachedTasks('Fix it', [552, 651])).toBe('Fix it\n#552 #651');
  });

  it('tidies trailing whitespace before adding the line', () => {
    expect(withAttachedTasks('Fix it  \n\n', [1])).toBe('Fix it\n#1');
  });

  it('replaces the existing line instead of adding a second one', () => {
    expect(withAttachedTasks('Fix it\n#552 #651', [552, 9])).toBe('Fix it\n#552 #9');
    expect(withAttachedTasks('Fix it\n#552 #651\n', [3])).toBe('Fix it\n#3');
  });

  it('removes the line when nothing is selected', () => {
    expect(withAttachedTasks('Fix it\n#552 #651', [])).toBe('Fix it');
    expect(withAttachedTasks('Fix it  ', [])).toBe('Fix it');
  });

  it('leaves a reference in the middle alone', () => {
    expect(withAttachedTasks('About #552\nmore', [1])).toBe('About #552\nmore\n#1');
  });

  it('writes only the line for an empty text', () => {
    expect(withAttachedTasks('', [4])).toBe('#4');
    expect(withAttachedTasks('#4', [])).toBe('');
  });
});
