import {
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { join, resolve } from 'node:path';
import process from 'node:process';

const outputDirectory = resolve(
  process.env.KEY_OUTPUT_DIR ?? '/run/secrets/cluchess',
);
const keyId = process.env.JWT_KID ?? 'local-dev-1';
const privateKeyPath = join(outputDirectory, 'jwt-private.pem');
const publicDirectory = join(outputDirectory, 'public');
const publicKeyPath = join(publicDirectory, `${keyId}.pem`);

mkdirSync(publicDirectory, { recursive: true });

if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
  setConfiguredOwnership(privateKeyPath, publicKeyPath);
  process.stdout.write(`Signing keys already exist for kid ${keyId}\n`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
setConfiguredOwnership(privateKeyPath, publicKeyPath);

if (
  !readFileSync(privateKeyPath, 'utf8').includes('PRIVATE KEY') ||
  !readFileSync(publicKeyPath, 'utf8').includes('PUBLIC KEY')
) {
  throw new Error('Generated signing keys failed validation');
}

process.stdout.write(`Generated Ed25519 signing keys for kid ${keyId}\n`);

function setConfiguredOwnership(privatePath, publicPath) {
  if (
    process.getuid?.() !== 0 ||
    process.env.KEY_OWNER_UID === undefined ||
    process.env.KEY_OWNER_GID === undefined
  ) {
    return;
  }

  const ownerUid = Number.parseInt(process.env.KEY_OWNER_UID, 10);
  const ownerGid = Number.parseInt(process.env.KEY_OWNER_GID, 10);
  if (!Number.isSafeInteger(ownerUid) || !Number.isSafeInteger(ownerGid)) {
    throw new Error('Configured key owner must use numeric UID and GID values');
  }

  chownSync(privatePath, ownerUid, ownerGid);
  chownSync(publicPath, ownerUid, ownerGid);
}
