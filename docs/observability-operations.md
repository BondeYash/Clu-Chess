# Observability Operations

## Zero-touch local stack

Start the application replicas, protected edge, Prometheus, Grafana, Tempo, and
the OpenTelemetry Collector:

```bash
docker compose -f compose.multi.yaml -f compose.observability.yaml up --build
```

Open:

- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- application edge: `https://localhost:3443`

The provisioned `CluChess Backend` dashboard covers request/error/duration,
connections, active games, matchmaking pressure, move and event-loop latency,
dependency failures, cleanup, reconnects, abandonment, and process stability.
Grafana also provisions Tempo for trace search.

Validate the alert rules, alert exercises, dashboard JSON, and merged Compose
model without starting the stack:

```bash
npm --prefix backend run test:observability:docker
```

## Correlation and traces

HTTP accepts only UUIDv4 `X-Correlation-Id` values and replaces invalid values.
Socket commands accept the same field in the protocol envelope. The value is
returned in HTTP headers and responses/acks, stored in async context, added to
structured command logs, and attached to application spans.

Manual spans cover:

- `session.create`;
- `realtime.command`;
- `mm.match`;
- `game.allocate`;
- `move.tx`;
- `game.snapshot.recover`;
- `db.transaction`;
- `redis.command`;
- `realtime.broadcast`.

Span attributes use bounded command/outcome values. Tokens, raw guest IDs,
Redis keys, SQL text, datastore URLs, and payloads are excluded.

The app uses parent-based head sampling. The provided topology sends all spans
to the Collector, which retains every error trace and 10 percent of successful
traces using tail sampling. A production deployment may lower
`OTEL_TRACE_SAMPLE_RATIO` only when it does not need error-complete tail
sampling.

## Prometheus metric contract

Metrics use bounded labels only. The metric registry rejects raw
guest/game/event/socket/correlation identifier label names and caps each family
at 100 series.

Key families include:

- `cluchess_http_requests_total` and
  `cluchess_http_request_duration_seconds`;
- `cluchess_ws_connections` and `cluchess_ws_connections_total`;
- `cluchess_mm_queue_depth`, `cluchess_mm_wait_seconds`, and
  `cluchess_matches_total`;
- `cluchess_active_rooms` and `cluchess_active_games`;
- accepted, rejected, duplicate, latency, conflict, and broadcast move metrics;
- PostgreSQL transaction and Redis command latency/error metrics;
- reconnect ratio, abandonment, cleanup, reconciliation, backpressure, process
  restart, event-loop lag, and resident-memory metrics.

`/metrics` is intentionally inaccessible through Nginx. Prometheus reaches each
replica on the internal Compose network and authenticates with the mounted
bearer-token file.

## Capacity signals and scale thresholds

The MVP design target is approximately 2,000 concurrent sockets, 1,000 active
games, and a short peak near 500 moves per second. Scale before a limit is
exhausted:

| Signal                        | Scale/investigate threshold                    |
| ----------------------------- | ---------------------------------------------- |
| Event-loop p99                | above 70 ms for 2 minutes                      |
| Move transaction p95          | above 100 ms for 5 minutes                     |
| App CPU                       | sustained above 70 percent                     |
| Per-instance socket count     | above validated connection budget              |
| PostgreSQL pool wait          | non-zero sustained wait or pool saturation     |
| PostgreSQL active connections | above 70 percent of database connection budget |
| Redis latency p95             | above 10 ms or any sustained errors            |
| Queue depth                   | rising for 2 minutes with no committed matches |
| Reconnect success             | below 90 percent for 5 minutes                 |
| Memory                        | above 75 percent of the container limit        |

Add stateless app replicas first. Increase PostgreSQL capacity/pooling before
adding read replicas because gameplay reads participate in authoritative write
flows. Move Redis to primary/replica with automatic failover before considering
Cluster, preserving the matchmaking key-slot rules in the architecture.
