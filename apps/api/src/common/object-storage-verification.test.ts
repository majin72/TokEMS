import { describe, expect, it } from 'vitest';
import { matchesDeclaredMediaType, readUploadWithinLimit } from './object-storage-verification.js';

describe('object storage upload verification', () => {
  it('stops reading as soon as an upload exceeds its declared size', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        },
      }),
    );
    await expect(readUploadWithinLimit(response, 3)).rejects.toThrow('exceeds');
  });

  it('checks file signatures independently from object metadata', () => {
    expect(
      matchesDeclaredMediaType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ),
    ).toBe(true);
    expect(matchesDeclaredMediaType(Buffer.from('<script>'), 'image/png')).toBe(false);
    expect(matchesDeclaredMediaType(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(matchesDeclaredMediaType(Buffer.from('PK...OFD.xml...'), 'application/ofd')).toBe(true);
  });
});
