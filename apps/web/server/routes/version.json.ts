import { resolveBuildInfo } from '@conference/contracts';

/**
 * Serves build metadata for health checks and release verification.
 * Handles GET and HEAD so `curl -I` and uptime probes work under any baseURL.
 */
export default defineEventHandler(() => resolveBuildInfo('web', process.env));
