import { Buffer } from 'node:buffer';
import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const findings = [];

for (const result of report.Results ?? []) {
  for (const vulnerability of result.Vulnerabilities ?? []) {
    findings.push(
      `${vulnerability.Severity} ${vulnerability.VulnerabilityID} in ${
        vulnerability.PkgName
      } (${result.Target})`,
    );
  }
  for (const secret of result.Secrets ?? []) {
    findings.push(
      `${secret.Severity ?? 'UNKNOWN'} secret ${secret.RuleID} in ${
        result.Target
      }`,
    );
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Runtime image security findings:\n${findings
      .map((finding) => `- ${finding}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Runtime image vulnerability and secret scan passed\n');
}
