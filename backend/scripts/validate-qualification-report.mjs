import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const reportPath = resolve(process.argv[2] ?? '');
const profile = process.argv[3] ?? 'smoke';
const outputPath = resolve(
  process.argv[4] ?? reportPath.replace(/\.json$/u, '-validation.json'),
);
const samplesPath =
  process.argv[5] === undefined ? undefined : resolve(process.argv[5]);
const metricsPath =
  process.argv[6] === undefined ? undefined : resolve(process.argv[6]);
if (!reportPath) {
  throw new Error(
    'Usage: validate-qualification-report.mjs REPORT PROFILE [OUTPUT]',
  );
}

const report = JSON.parse(await readFile(reportPath, 'utf8'));
const aggregate = report.aggregate ?? report;
const counters = aggregate.counters ?? {};
const summaries = aggregate.summaries ?? {};
const rates = aggregate.rates ?? {};
const samples =
  samplesPath === undefined
    ? []
    : (await readFile(samplesPath, 'utf8'))
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
const metrics =
  metricsPath === undefined
    ? undefined
    : JSON.parse(await readFile(metricsPath, 'utf8'));
const expectations = {
  burst: { minimumSockets: 900, requireGames: true },
  smoke: { minimumSockets: 4, requireGames: true },
  soak: { minimumSockets: 180, requireGames: true },
  stress: { minimumSockets: 2250, requireGames: false },
  target: { minimumSockets: 1800, requireGames: true },
}[profile];
if (expectations === undefined) {
  throw new Error(`Unknown qualification profile ${profile}`);
}

const checks = [];
check(
  'virtual users complete without engine errors',
  number(counters['vusers.failed']) === 0 &&
    number(counters['errors.SocketError']) === 0,
  {
    socketErrors: number(counters['errors.SocketError']),
    virtualUsersFailed: number(counters['vusers.failed']),
  },
);
check(
  'authenticated socket target reached',
  number(counters.authenticated_sockets_connected) >=
    expectations.minimumSockets,
  {
    minimum: expectations.minimumSockets,
    observed: number(counters.authenticated_sockets_connected),
  },
);
if (expectations.requireGames) {
  if (profile !== 'smoke') {
    check(
      'scripted openings completed',
      number(counters.opening_games_driven) > 0,
      {
        observed: number(counters.opening_games_driven),
      },
    );
  }
  check(
    'known checkmate path completed',
    number(counters.checkmate_games_driven) > 0,
    {
      observed: number(counters.checkmate_games_driven),
    },
  );
}
checkP95('guest session create p95', 'session_bootstrap_latency', 150);
checkP95('authenticated WS connect p95', 'ws_connect_latency', 300);
if (expectations.requireGames) {
  checkP95(
    'match with waiting opponent p95',
    'match_with_waiting_opponent_latency',
    500,
    profile === 'smoke',
  );
  checkP95(
    'move validate and persist p95',
    'move_validate_persist_latency',
    50,
    profile === 'smoke',
  );
}
if (number(counters.hard_reconnects_completed) > 0) {
  checkP95('reconnect and snapshot p95', 'reconnect_snapshot_latency', 800);
}
check(
  'application, datastore, and load-balancer metrics were sampled',
  samples.length > 0,
  { observedSamples: samples.length },
);
if (samples.length > 0) {
  const completeSamples = samples.filter(
    (sample) => sample.error === undefined && sample.applications?.length === 2,
  );
  check('both application replicas were sampled', completeSamples.length > 0, {
    completeSamples: completeSamples.length,
  });
  const peakConnections = maximum(
    completeSamples.map((sample) =>
      sample.applications.reduce(
        (sum, application) =>
          sum + prometheusGauge(application.metrics, 'cluchess_ws_connections'),
        0,
      ),
    ),
  );
  const peakActiveGames = maximum(
    completeSamples.map((sample) => number(sample.postgres?.active_games)),
  );
  const peakDatabaseConnections = maximum(
    completeSamples.map((sample) =>
      number(sample.postgres?.database_connections),
    ),
  );
  const peakRedisStream = maximum(
    completeSamples.map((sample) => number(sample.redis?.socketStreamLength)),
  );
  const peakRejectedConnections = maximum(
    completeSamples.map((sample) => number(sample.redis?.rejected_connections)),
  );
  const peakEvictions = maximum(
    completeSamples.map((sample) => number(sample.redis?.evicted_keys)),
  );
  const residentMemory = completeSamples.map((sample) =>
    sample.applications.reduce(
      (sum, application) =>
        sum +
        prometheusGauge(application.metrics, 'process_resident_memory_bytes'),
      0,
    ),
  );
  const eventLoopLag = completeSamples.map((sample) =>
    maximum(
      sample.applications.map((application) =>
        prometheusGauge(application.metrics, 'nodejs_eventloop_lag_seconds'),
      ),
    ),
  );
  const redisMemory = completeSamples.map((sample) =>
    number(sample.redis?.used_memory),
  );
  check('Redis stream remained bounded', peakRedisStream <= 10_000, {
    maximum: 10_000,
    observed: peakRedisStream,
  });
  check(
    'Redis had no rejected connections or evictions',
    peakRejectedConnections === 0 && peakEvictions === 0,
    {
      evictions: peakEvictions,
      rejectedConnections: peakRejectedConnections,
    },
  );
  check('database pool remained bounded', peakDatabaseConnections <= 105, {
    maximum: 105,
    observed: peakDatabaseConnections,
  });
  check(
    'application resident memory remained bounded',
    residentMemory.length > 0 &&
      residentMemory.at(-1) <= residentMemory[0] * 2 + 256 * 1024 * 1024,
    {
      firstBytes: residentMemory[0] ?? null,
      lastBytes: residentMemory.at(-1) ?? null,
      peakBytes: maximum(residentMemory),
    },
  );
  check(
    'Redis memory remained bounded',
    redisMemory.length > 0 &&
      redisMemory.at(-1) <= redisMemory[0] * 2 + 64 * 1024 * 1024,
    {
      firstBytes: redisMemory[0] ?? null,
      lastBytes: redisMemory.at(-1) ?? null,
      peakBytes: maximum(redisMemory),
    },
  );
  check('event-loop lag remained bounded', maximum(eventLoopLag) <= 1, {
    maximumSeconds: 1,
    observedSeconds: maximum(eventLoopLag),
  });
  if (profile === 'target') {
    check(
      'target sustained approximately 1000 active games',
      peakActiveGames >= 900,
      {
        minimum: 900,
        observed: peakActiveGames,
      },
    );
    check(
      'target reached 2000 physical sockets within tolerance',
      peakConnections >= 1800,
      {
        minimum: 1800,
        observed: peakConnections,
      },
    );
  }
  if (profile === 'stress') {
    check(
      'stress reached 2500 physical sockets within tolerance',
      peakConnections >= 2250,
      {
        minimum: 2250,
        observed: peakConnections,
      },
    );
  }
}
if (metrics !== undefined && expectations.requireGames) {
  const applicationMetrics = metrics.applications.map(
    (application) => application.metrics,
  );
  const moveP95Seconds = histogramP95(
    applicationMetrics,
    'cluchess_move_latency_seconds',
  );
  const broadcastP95Seconds = histogramP95(
    applicationMetrics,
    'cluchess_broadcast_latency_seconds',
    'event="move.accepted"',
  );
  check('server move validate and persist p95', moveP95Seconds <= 0.05, {
    maximumSeconds: 0.05,
    observedSeconds: moveP95Seconds,
  });
  check('server commit-to-broadcast p95', broadcastP95Seconds <= 0.05, {
    maximumSeconds: 0.05,
    observedSeconds: broadcastP95Seconds,
  });
}
if (profile === 'burst') {
  const observedRate =
    number(rates.committed_move_rate?.mean) ||
    number(rates.committed_move_rate);
  check('committed move burst reaches 500 moves/second', observedRate >= 500, {
    minimum: 500,
    observed: observedRate,
  });
}

const failed = checks.filter((entry) => !entry.ok && !entry.advisory);
const result = {
  checks,
  failed: failed.length,
  profile,
  schemaVersion: 1,
  source: reportPath,
  validatedAt: new Date().toISOString(),
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failed.length > 0) {
  process.exitCode = 1;
}

function check(name, ok, details, advisory = false) {
  checks.push({ advisory, details, name, ok });
}

function checkP95(name, metric, maximum, advisory = false) {
  const summary = summaries[metric];
  const observed = number(summary?.p95);
  check(
    name,
    summary !== undefined && observed <= maximum,
    { maximum, metric, observed: summary === undefined ? null : observed },
    advisory,
  );
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maximum(values) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function prometheusGauge(metricsText, metricName) {
  return metricsText
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line.startsWith(`${metricName}{`) || line.startsWith(`${metricName} `),
    )
    .reduce((sum, line) => sum + number(line.split(/\s+/u).at(-1)), 0);
}

function histogramP95(metricDocuments, metricName, requiredLabel) {
  const buckets = new Map();
  for (const document of metricDocuments) {
    for (const line of document.split(/\r?\n/u)) {
      if (
        !line.startsWith(`${metricName}_bucket`) ||
        (requiredLabel !== undefined && !line.includes(requiredLabel))
      ) {
        continue;
      }
      const boundMatch = /le="([^"]+)"/u.exec(line);
      if (boundMatch === null) {
        continue;
      }
      const bound =
        boundMatch[1] === '+Inf'
          ? Number.POSITIVE_INFINITY
          : Number(boundMatch[1]);
      buckets.set(
        bound,
        (buckets.get(bound) ?? 0) + number(line.split(/\s+/u).at(-1)),
      );
    }
  }
  const ordered = [...buckets.entries()].sort(
    ([left], [right]) => left - right,
  );
  const total = ordered.at(-1)?.[1] ?? 0;
  if (total === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const target = total * 0.95;
  return (
    ordered.find(([, count]) => count >= target)?.[0] ??
    Number.POSITIVE_INFINITY
  );
}
