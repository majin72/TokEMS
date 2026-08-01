import { describe, expect, it } from 'vitest';
import { LoginResultSchema, LoginSchema } from './index.js';

describe('administrator username and password login contract', () => {
  it('accepts administrator username credentials', () => {
    expect(LoginSchema.parse({ username: 'admin', password: 'admin' })).toEqual({
      username: 'admin',
      password: 'admin',
    });
  });

  it('keeps legacy email payloads compatible with automation clients', () => {
    expect(
      LoginSchema.parse({
        email: 'admin@tokems.local',
        password: 'admin',
      }),
    ).toEqual({
      username: 'admin@tokems.local',
      password: 'admin',
    });
  });

  it('publishes a compact numeric administrator ID', () => {
    const result = {
      accessToken: 'token',
      user: {
        id: 101,
        email: 'admin@tokems.local',
        name: '组织管理员',
        role: 'organization_admin',
      },
    };
    expect(LoginResultSchema.parse(result).user.id).toBe(101);
    expect(
      LoginResultSchema.safeParse({
        ...result,
        user: { ...result.user, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }).success,
    ).toBe(false);
  });
});
