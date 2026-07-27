# Observability Alert Runbooks

Alert owner: backend on-call. In production, route critical alerts to the
paging channel and warnings to the operations channel. Every incident should
record the alert start/end, affected instance(s), correlation IDs, mitigation,
and follow-up owner.

## Event-loop lag

Confirm whether one instance or the fleet is affected. Compare CPU, memory,
socket count, request rate, move latency, and recent deployments. Remove a
single unhealthy replica from rotation; otherwise scale app replicas. Capture a
CPU profile only through an approved internal diagnostic path. Roll back a
recent release if lag began at deployment and does not fall after scaling.

## Move latency

Follow a slow move correlation ID through `realtime.command`, `move.tx`,
`db.transaction`, Redis cleanup, and `realtime.broadcast`. Check PostgreSQL
locks, pool saturation, statement timeouts, event-loop lag, and Redis latency.
Never retry a move with a new `clientMoveId`; clients must replay the original
identifier. Scale app or database capacity based on the dominant span.

## Matchmaking stall

Check Redis readiness, queue depth by mode, matchmaking reconciliation failures,
and committed-match rate. Confirm all replicas use the same Redis and PostgreSQL
stores. Restart only an unhealthy replica; leaderless drain/reconcile jobs on
healthy replicas will continue. Do not manually delete queue keys until the
durable active-assignment audit is complete.

## PostgreSQL failures

Check readiness, connection/pool saturation, database CPU/storage, lock waits,
and transaction timeout errors. Match the failing correlation ID to the
database span. Gameplay mutations fail closed, so preserve idempotency keys
during retries. Fail over through the managed database procedure; do not promote
a read replica that is not caught up.

## Redis errors

Check Redis availability, authentication/TLS status, memory, eviction, and
latency. Matchmaking and new admission fail closed; already authenticated
gameplay rate counters may fail open while PostgreSQL remains authoritative.
Fail over through the Redis primary/replica procedure. After recovery, monitor
reconciliation repairs, queue depth, presence, and adapter degradation.

## Reconnect failures

Check edge WSS upgrades, origin rejections, sticky routing, adapter state,
presence TTLs, and app restart rate. Use a correlation ID to verify that
`session.ready` and `game.snapshot` complete after reconnect. Scale or remove
flapping replicas. Do not extend grace periods during an incident without
checking clock and abandonment semantics.

## Cleanup failures

Identify the `job` label, then inspect reconciliation metrics and bounded
structured logs. Verify PostgreSQL and Redis health. All cleanup jobs are
idempotent and leaderless; allow a healthy replica to retry. Run the documented
recovery audit before editing ephemeral Redis state.

## Instance flapping

Inspect container exit reason, readiness history, memory limit, event-loop lag,
dependency availability, and the deployment revision. Stop the rollout if the
new revision is involved. Confirm graceful drain logs before terminating
additional replicas. Keep enough healthy capacity for current sockets and
reconnect load.
