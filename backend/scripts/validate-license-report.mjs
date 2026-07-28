import { Buffer } from 'node:buffer';
import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const forbiddenLicensePatterns = [
  /^AGPL-3\.0(?:-only|-or-later)?$/u,
  /^GPL-2\.0(?:-only|-or-later)?$/u,
  /^GPL-3\.0(?:-only|-or-later)?$/u,
];
const violations = [];
let scannedLicenses = 0;

for (const result of report.Results ?? []) {
  for (const license of result.Licenses ?? []) {
    scannedLicenses += 1;
    if (
      forbiddenLicensePatterns.some((pattern) => pattern.test(license.Name))
    ) {
      violations.push({
        license: license.Name,
        package: license.PkgName,
      });
    }
  }
}

if (scannedLicenses === 0) {
  process.stderr.write(
    'License scanner returned no production dependency licenses\n',
  );
  process.exitCode = 1;
} else if (violations.length > 0) {
  process.stderr.write(
    `Forbidden production licenses detected:\n${violations
      .map(
        ({ license, package: packageName }) => `- ${packageName}: ${license}`,
      )
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Production dependency license policy passed (${scannedLicenses} licenses checked)\n`,
  );
}
