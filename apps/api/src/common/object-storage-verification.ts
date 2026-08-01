export async function readUploadWithinLimit(response: Response, expectedSize: number) {
  const declaredLengthValue = response.headers.get('content-length');
  const declaredLength = declaredLengthValue === null ? undefined : Number(declaredLengthValue);
  if (
    declaredLength !== undefined &&
    (!Number.isSafeInteger(declaredLength) || declaredLength !== expectedSize)
  ) {
    throw new Error('uploaded object size does not match the declared size');
  }
  if (!response.body) throw new Error('uploaded object has no readable body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > expectedSize) {
        await reader.cancel();
        throw new Error('uploaded object exceeds the declared size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedSize) {
    throw new Error('uploaded object size does not match the declared size');
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

export function matchesDeclaredMediaType(file: Buffer, mediaType: string) {
  if (mediaType === 'image/jpeg') {
    return file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
  }
  if (mediaType === 'image/png') {
    return file
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mediaType === 'image/webp') {
    return (
      file.subarray(0, 4).toString('ascii') === 'RIFF' &&
      file.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mediaType === 'application/pdf') {
    return file.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (mediaType === 'application/ofd') {
    return (
      file.subarray(0, 2).toString('ascii') === 'PK' &&
      (file.includes(Buffer.from('OFD.xml')) || file.includes(Buffer.from('ofd.xml')))
    );
  }
  return false;
}
