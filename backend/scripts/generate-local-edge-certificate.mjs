import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const outputDirectory = resolve(
  process.env.EDGE_TLS_OUTPUT_DIR ?? '/run/secrets/cluchess-edge',
);
const certificatePath = join(outputDirectory, 'tls.crt');
const privateKeyPath = join(outputDirectory, 'tls.key');

mkdirSync(outputDirectory, { recursive: true });

if (existsSync(certificatePath) && existsSync(privateKeyPath)) {
  validate();
  process.stdout.write('Local edge TLS certificate already exists\n');
  process.exit(0);
}

execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-days',
    '30',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout',
    privateKeyPath,
    '-out',
    certificatePath,
  ],
  { stdio: 'ignore' },
);
chmodSync(privateKeyPath, 0o600);
chmodSync(certificatePath, 0o644);
validate();
process.stdout.write('Generated local edge TLS certificate\n');

function validate() {
  if (
    !readFileSync(privateKeyPath, 'utf8').includes('PRIVATE KEY') ||
    !readFileSync(certificatePath, 'utf8').includes('CERTIFICATE')
  ) {
    throw new Error('Generated edge TLS certificate failed validation');
  }
}
