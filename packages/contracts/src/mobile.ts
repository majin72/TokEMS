import { z } from 'zod';

export const MainlandMobileSchema = z
  .string()
  .trim()
  .regex(/^(?:\+?86)?1[3-9]\d{9}$/, '请输入有效的中国大陆手机号');
