import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const assets = [
  {
    source: 'src/modules/matchmaking/infrastructure/lua',
    target: 'dist/modules/matchmaking/infrastructure/lua',
  },
];

for (const asset of assets) {
  mkdirSync(dirname(asset.target), { recursive: true });
  cpSync(asset.source, asset.target, { recursive: true });
}
