import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '../packages/ui');
await mkdir(resolve(packageRoot, 'dist'), { recursive: true });
await copyFile(resolve(packageRoot, 'src/tokens.css'), resolve(packageRoot, 'dist/tokens.css'));
