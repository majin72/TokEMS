import { describe, expect, it } from 'vitest';
import {
  htmlImportStagedAssetIds,
  publishedHtmlEtag,
  redactRemoteResourceUrl,
} from './html-template-operations.service.js';

describe('HTML import staged asset ownership', () => {
  it('cleans only assets created for the import', () => {
    expect(
      htmlImportStagedAssetIds({
        assetManifest: [
          { assetId: '11111111-1111-4111-8111-111111111111', staged: false },
          { assetId: '22222222-2222-4222-8222-222222222222', staged: true },
          { assetId: '33333333-3333-4333-8333-333333333333' },
        ],
      }),
    ).toEqual(['22222222-2222-4222-8222-222222222222']);
  });
});

describe('published HTML cache identity', () => {
  it('changes whenever the final HTML response changes', () => {
    const original = publishedHtmlEtag('<html><body><h1>大会 A</h1></body></html>');
    const changed = publishedHtmlEtag('<html><body><h1>大会 B</h1></body></html>');

    expect(original).toMatch(/^"[a-f0-9]{64}"$/u);
    expect(changed).not.toBe(original);
    expect(publishedHtmlEtag('<html><body><h1>大会 A</h1></body></html>')).toBe(original);
  });
});

describe('remote resource URL redaction', () => {
  it('removes credentials, query tokens, fragments and inline payloads', () => {
    expect(
      redactRemoteResourceUrl(
        'https://user:password@cdn.example.com/images/hero.png?token=secret#preview',
      ),
    ).toBe('https://cdn.example.com/images/hero.png');
    expect(redactRemoteResourceUrl('/images/hero.png?token=secret#preview')).toBe(
      '/images/hero.png',
    );
    expect(redactRemoteResourceUrl('data:image/png;base64,c2VjcmV0')).toBe(
      'data:[content-redacted]',
    );
  });
});
