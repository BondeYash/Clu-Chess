import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDocs = dirname(fileURLToPath(import.meta.url));
const repository = resolve(frontendDocs, '../..');
const failures = [];

validateRequiredArtifacts();
validateAdrs();
validateContractCoverage();
validateLocalLinks();
validateContrast();
validatePrototype();
validateMasterPlan();

if (failures.length > 0) {
  process.stderr.write(
    `Frontend Phase 0 validation failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    [
      'Frontend Phase 0 validation passed.',
      '- required artifacts: present',
      '- accepted frontend ADRs: 8/8',
      '- HTTP routes: 9/9',
      '- client Socket.IO commands: 7/7',
      '- server Socket.IO events: 13/13',
      '- protocol error codes: 17/17',
      '- local Markdown links: valid',
      '- specified text contrast pairs: WCAG AA or better',
      '- keyboard prototype: structurally complete',
      '- master plan Phase 0 status: complete',
    ].join('\n') + '\n',
  );
}

function validateRequiredArtifacts() {
  const required = [
    'README.md',
    'product-scope.md',
    'route-map.md',
    'user-flows.md',
    'wireframes.md',
    'design-system.md',
    'component-state-inventory.md',
    'contract-coverage.md',
    'asset-register.md',
    'phase-0-acceptance.md',
    'prototypes/README.md',
    'prototypes/board-keyboard.html',
    'prototypes/board-keyboard.css',
    'prototypes/board-keyboard.js',
  ];
  for (const relative of required) {
    if (!existsSync(join(frontendDocs, relative))) {
      failures.push(`missing required artifact ${relative}`);
    }
  }
}

function validateAdrs() {
  const adrDirectory = join(frontendDocs, 'adr');
  const adrs = readdirSync(adrDirectory)
    .filter((file) => /^F\d{4}.*\.md$/.test(file))
    .sort();
  if (adrs.length !== 8) {
    failures.push(`expected 8 frontend ADRs, found ${adrs.length}`);
  }
  const sections = [
    '## Context',
    '## Decision',
    '## Rejected alternatives',
    '## Consequences',
    '## Verification',
  ];
  for (const file of adrs) {
    const document = readFileSync(join(adrDirectory, file), 'utf8');
    if (!document.includes('**Status:** Accepted')) {
      failures.push(`${file} is not accepted`);
    }
    for (const section of sections) {
      if (!document.includes(section)) {
        failures.push(`${file} is missing ${section}`);
      }
    }
  }
}

function validateContractCoverage() {
  const constants = readFileSync(
    join(repository, 'packages/protocol-v1/src/constants.ts'),
    'utf8',
  );
  const coverage = readFileSync(
    join(frontendDocs, 'contract-coverage.md'),
    'utf8',
  );
  const groups = {
    'HTTP route': [
      'POST /v1/session',
      'POST /v1/session/renew',
      'GET /v1/session',
      'POST /v1/session/reset',
      'GET /v1/games/active',
      'GET /v1/games/:id/snapshot',
      'GET /healthz',
      'GET /readyz',
      'GET /metrics',
    ],
    'client command': constantList(constants, 'CLIENT_EVENT_NAMES'),
    'server event': constantList(constants, 'SERVER_EVENT_NAMES'),
    'protocol error': constantList(constants, 'PROTOCOL_ERROR_CODES'),
  };

  for (const [group, values] of Object.entries(groups)) {
    for (const value of values) {
      if (!coverage.includes(`\`${value}\``)) {
        failures.push(`${group} ${value} is missing from contract coverage`);
      }
    }
  }
}

function constantList(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`),
  );
  if (match === null) {
    failures.push(`could not parse shared protocol constant ${name}`);
    return [];
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function validateLocalLinks() {
  const markdownFiles = recursiveFiles(frontendDocs).filter((file) =>
    file.endsWith('.md'),
  );
  for (const file of markdownFiles) {
    const document = readFileSync(file, 'utf8');
    for (const match of document.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (target.length === 0 || /^[a-z]+:/i.test(target)) {
        continue;
      }
      if (!existsSync(resolve(dirname(file), target))) {
        failures.push(
          `${file.slice(repository.length + 1)} has missing link ${target}`,
        );
      }
    }
  }
}

function recursiveFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(path) : [path];
  });
}

function validateContrast() {
  const pairs = [
    ['#1C211E', '#F3F0E8'],
    ['#5C625C', '#F3F0E8'],
    ['#FFFFFF', '#A65335'],
    ['#FFFFFF', '#7B3D28'],
    ['#1C211E', '#D7B46A'],
    ['#1C211E', '#E7E0D2'],
    ['#FFFFFF', '#6D7763'],
  ];
  for (const [foreground, background] of pairs) {
    const ratio = contrast(foreground, background);
    if (ratio < 4.5) {
      failures.push(
        `contrast ${foreground}/${background} is ${ratio.toFixed(2)}:1`,
      );
    }
  }
}

function contrast(first, second) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function validatePrototype() {
  const html = readFileSync(
    join(frontendDocs, 'prototypes/board-keyboard.html'),
    'utf8',
  );
  const css = readFileSync(
    join(frontendDocs, 'prototypes/board-keyboard.css'),
    'utf8',
  );
  const javascript = readFileSync(
    join(frontendDocs, 'prototypes/board-keyboard.js'),
    'utf8',
  );
  const requirements = [
    [html, 'role="grid"'],
    [html, 'aria-live="polite"'],
    [css, '@media (forced-colors: active)'],
    [javascript, 'ArrowLeft'],
    [javascript, 'ArrowRight'],
    [javascript, 'ArrowUp'],
    [javascript, 'ArrowDown'],
    [javascript, 'Home'],
    [javascript, 'End'],
    [javascript, 'Escape'],
    [javascript, 'tabIndex = -1'],
  ];
  for (const [source, requirement] of requirements) {
    if (!source.includes(requirement)) {
      failures.push(`keyboard prototype is missing ${requirement}`);
    }
  }
  try {
    Function(javascript);
  } catch (error) {
    failures.push(
      `keyboard prototype JavaScript does not parse: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function validateMasterPlan() {
  const plan = readFileSync(join(repository, 'FRONTEND_PLAN.md'), 'utf8');
  const phaseStart = plan.indexOf(
    '### Phase 0 — Product, contract, and design closure',
  );
  const phaseEnd = plan.indexOf('### Phase 1', phaseStart);
  const phase = plan.slice(phaseStart, phaseEnd);
  if (!phase.includes('**Status:** Complete')) {
    failures.push('master plan does not mark Phase 0 complete');
  }
  if (!phase.includes('docs/frontend/')) {
    failures.push('master plan does not link Phase 0 artifacts');
  }
}
