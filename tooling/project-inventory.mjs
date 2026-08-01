import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collectProjectInventory } from './lib/project-inventory.mjs';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'docs/generated/project-inventory.json');
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((file) => file && existsSync(resolve(root, file)));
const inventory = await collectProjectInventory(root, files);
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(target, 'utf8');
  } catch {
    // The comparison below reports the missing snapshot.
  }
  if (current !== serialized) {
    console.error('Project inventory snapshot is stale. Run pnpm docs:inventory.');
    console.error(serialized);
    process.exit(1);
  }
  console.info('Project inventory snapshot is current');
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized, 'utf8');
  console.info('docs/generated/project-inventory.json');
}
