import { chmodSync, copyFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const hooksDir = resolve(
  root,
  execSync('git rev-parse --git-path hooks', { encoding: 'utf8' }).trim(),
);
const source = join(root, '.githooks');

for (const name of readdirSync(source)) {
  const target = join(hooksDir, name);
  copyFileSync(join(source, name), target);
  chmodSync(target, 0o755);
}

console.log(`Git hooks instalados en ${hooksDir}`);
