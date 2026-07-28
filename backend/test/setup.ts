import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const keyDirectory = join(
  tmpdir(),
  `cluchess-test-keys-${String(process.pid)}`,
);
const publicDirectory = join(keyDirectory, 'public');
const privateKeyPath = join(keyDirectory, 'jwt-private.pem');
const publicKeyPath = join(publicDirectory, 'test-1.pem');

mkdirSync(publicDirectory, { recursive: true });

if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
}

process.env.JWT_PRIVATE_KEY_FILE = privateKeyPath;
process.env.JWT_PUBLIC_KEYS_DIR = publicDirectory;
process.env.JWT_KID = 'test-1';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.ORIGIN_ALLOWLIST = 'http://test.local';
process.env.OTEL_ENABLED = 'false';
