import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { buildReleaseManifest, parseTestResults } from './lib/release-manifest.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentsFor(name) {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : [],
  );
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function imageDigests(prefix) {
  const services = ['api', 'worker', 'web', 'admin', 'gateway', 'notification-sink'];
  return Object.fromEntries(
    services.flatMap((service) => {
      try {
        const reference = `${prefix}-${service}:local`;
        const id = execFileSync('docker', ['image', 'inspect', reference, '--format', '{{.Id}}'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return id ? [[service, id]] : [];
      } catch {
        return [];
      }
    }),
  );
}

async function openApiSummary() {
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8088';
  try {
    const response = await fetch(`${origin}/api/openapi.json`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return { available: false };
    const document = await response.json();
    const paths = Object.values(document.paths ?? {});
    const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
    return {
      available: true,
      pathCount: paths.length,
      operationCount: paths.reduce(
        (total, path) =>
          total + Object.keys(path).filter((method) => methods.has(method.toLowerCase())).length,
        0,
      ),
    };
  } catch {
    return { available: false };
  }
}

const root = resolve(import.meta.dirname, '..');
const runId = new Date().toISOString().replaceAll(/[-:.]/gu, '').replace('Z', 'Z');
const target = resolve(
  root,
  argument('--output') ?? `test-results/remediation/${runId}/manifest.json`,
);
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const manifest = await buildReleaseManifest({
  root,
  files,
  git: {
    sha: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current') || 'detached',
    dirty: git('status', '--porcelain').length > 0,
  },
  builtAt: process.env.BUILD_TIME ?? new Date().toISOString(),
  imageDigests: imageDigests(argument('--image-prefix') ?? 'tokems'),
  openApi: await openApiSummary(),
  environment: {
    deploymentMode: process.env.DEPLOYMENT_MODE ?? 'unknown',
    node: process.version,
    publicOriginSha256: process.env.PUBLIC_ORIGIN
      ? createHash('sha256').update(process.env.PUBLIC_ORIGIN).digest('hex')
      : 'unknown',
  },
  testResults: parseTestResults(argumentsFor('--test-result')),
});
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.info(relative(root, target));
