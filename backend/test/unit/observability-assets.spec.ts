import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const alerts = readFileSync('observability/alerts.yml', 'utf8');
const dashboard = JSON.parse(
  readFileSync(
    'observability/grafana/dashboards/cluchess-overview.json',
    'utf8',
  ),
) as { panels: readonly { targets?: readonly { expr?: string }[] }[] };

describe('operational observability assets', () => {
  it('links every required alert to its runbook', () => {
    for (const alert of [
      'CluChessEventLoopLagHigh',
      'CluChessMoveLatencySloBreach',
      'CluChessMatchmakingStalled',
      'CluChessDatabaseFailures',
      'CluChessRedisErrors',
      'CluChessReconnectFailures',
      'CluChessCleanupFailing',
      'CluChessInstanceFlapping',
    ]) {
      expect(alerts).toContain(`alert: ${alert}`);
    }
    expect(alerts.match(/runbook_url:/g)).toHaveLength(8);
  });

  it('provisions RED, saturation, matchmaking, dependency, and recovery views', () => {
    const expressions = dashboard.panels
      .flatMap((panel) => panel.targets ?? [])
      .map((target) => target.expr ?? '')
      .join('\n');

    for (const metric of [
      'cluchess_ws_connections',
      'cluchess_active_games',
      'cluchess_move_latency_seconds_bucket',
      'nodejs_eventloop_lag_seconds_bucket',
      'cluchess_mm_queue_depth',
      'cluchess_pg_tx_failures_total',
      'cluchess_redis_errors_total',
      'cluchess_reconnect_success_ratio',
    ]) {
      expect(expressions).toContain(metric);
    }
  });
});
