/**
 * TypeScript (tsc) only emits .js from .ts; it does not copy static assets.
 * After `tsc`, this copies files that must sit beside dist/index.js at runtime.
 */
import { copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

copyFileSync(join(root, 'src', 'favico.ico'), join(root, 'dist', 'favico.ico'));
