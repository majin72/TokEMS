import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFERENCE_TEMPLATE_DEFINITION } from '@conference/contracts';
import { mergeTemplateDefinition } from './template-operations.service.js';

describe('template experience resolution', () => {
  it('applies event overrides by stable node key after template reordering', () => {
    const reordered = structuredClone(DEFAULT_CONFERENCE_TEMPLATE_DEFINITION);
    expect(reordered.presentation.kind).toBe('structured');
    if (reordered.presentation.kind !== 'structured') return;
    reordered.presentation.home.blocks.reverse();

    const resolved = mergeTemplateDefinition(reordered, {
      home: {
        'home.hero': {
          content: { primaryAction: '领取参会席位' },
        },
      },
    });

    expect(resolved.presentation.kind).toBe('structured');
    if (resolved.presentation.kind !== 'structured') return;
    const hero = resolved.presentation.home.blocks.find((block) => block.nodeKey === 'home.hero');
    expect(hero?.content.primaryAction).toBe('领取参会席位');
    expect(resolved.presentation.home.blocks[0]?.nodeKey).toBe('home.footer');
  });
});
