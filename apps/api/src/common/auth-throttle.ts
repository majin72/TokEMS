export function adminLoginThrottleLimit(environment: Record<string, string | undefined>) {
  return environment.DEPLOYMENT_MODE === 'local' ? 100 : 10;
}
