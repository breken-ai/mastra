import { describe, expect, it } from 'vitest';

import { SentenceTransformer } from './sentence';

const A = 'Aaaaaaaaaaaaa.'; // 14 characters
const B = 'Bbbbbbbbbbbbb.'; // 14 characters
const C = 'Ccccccccccccccccccccccccc.'; // 26 characters

describe('SentenceTransformer overlap', () => {
  const transformer = () => new SentenceTransformer({ maxSize: 30, minSize: 1, overlap: 15 });

  it('does not emit a trailing chunk made only of overlap', () => {
    expect(transformer().splitText({ text: `${A} ${B}` })).toEqual([`${A} ${B}`]);
  });

  it('keeps every chunk within maxSize and never repeats overlap as its own chunk', () => {
    const chunks = transformer().splitText({ text: `${A} ${B} ${C}` });

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
    expect(chunks).toEqual([`${A} ${B}`, C]);
  });

  it('still carries overlap into the next chunk when it fits', () => {
    const D = 'Dddd.';
    const chunks = transformer().splitText({ text: `${A} ${B} ${D}` });

    expect(chunks).toEqual([`${A} ${B}`, `${B} ${D}`]);
  });
});
