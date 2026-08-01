import { describe, expect, it } from 'vitest';
import {
  CreateEventSchema,
  DEMO_EVENT,
  DEMO_EVENT_EXPERIENCE,
  PublicEventSchema,
} from './index.js';

describe('CreateEventSchema', () => {
  it('requires an explicit published template version', () => {
    const result = CreateEventSchema.safeParse({
      name: 'TokEMS 全球活动运营峰会',
      shortName: 'TokEMS 2027',
      slug: 'tokems-2027',
      startsAt: '2027-06-18T01:00:00.000Z',
      endsAt: '2027-06-19T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      venue: '深圳国际会展中心',
      city: '深圳',
      address: '宝安区福海街道展城路 1 号',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'templateVersionId')).toBe(
      true,
    );
  });
});

describe('DEMO_EVENT', () => {
  it('ships with the published default conference experience', () => {
    const event = PublicEventSchema.parse(DEMO_EVENT);

    expect(event.experience).toEqual(DEMO_EVENT_EXPERIENCE);
    expect(event.experience?.template.versionId).toBe('19191919-1919-4191-8191-191919191919');
    expect(event.experience?.home.blocks.map((block) => block.nodeKey)).toContain('home.hero');
  });
});
