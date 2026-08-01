import { resolveBuildInfo } from '@conference/contracts';

export default defineEventHandler(() => resolveBuildInfo('web', process.env));
