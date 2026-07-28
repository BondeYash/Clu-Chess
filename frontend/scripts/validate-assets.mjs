import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve('public');
const allowedExtensions = new Set(['', '.avif', '.png', '.svg', '.webp']);
const maximumBytes = 64 * 1024;
const files = await walk(root);

if (files.length === 0) {
  throw new Error('No registered frontend assets were found');
}

for (const file of files) {
  const extension = extname(file).toLowerCase();
  const asset = relative(root, file);
  if (!allowedExtensions.has(extension)) {
    throw new Error(`Unregistered asset extension: ${asset}`);
  }

  const metadata = await stat(file);
  if (metadata.size > maximumBytes) {
    throw new Error(`Asset exceeds the 64 KiB Phase 2 budget: ${asset}`);
  }

  if (extension === '.svg') {
    const source = await readFile(file, 'utf8');
    if (/<script|(?:href|src)=["'](?:https?:|data:image)/i.test(source)) {
      throw new Error(`Unsafe or externally referenced SVG: ${asset}`);
    }
  }
}

console.log(
  `Frontend asset validation passed (${files.length} files, each <= 64 KiB)`,
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}
