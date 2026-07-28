import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);

if (packageManifest.name !== 'cluchess-backend') {
  throw new Error('Refusing to clean an unexpected project directory');
}

for (const artifact of ['coverage', 'dist', 'tsconfig.tsbuildinfo']) {
  rmSync(join(projectRoot, artifact), { force: true, recursive: true });
}
