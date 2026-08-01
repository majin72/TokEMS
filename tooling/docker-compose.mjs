import { spawnSync } from 'node:child_process';
import { localComposeEnvironment } from './lib/local-compose-environment.mjs';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node tooling/docker-compose.mjs <docker compose arguments>');
  process.exit(2);
}

const result = spawnSync('docker', ['compose', ...args], {
  cwd: process.cwd(),
  env: localComposeEnvironment(),
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
