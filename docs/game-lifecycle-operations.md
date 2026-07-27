# Non-move Game Lifecycle Operations

> **Status:** Phase 8 implementation contract
> **Protocol authority:** [`protocol-v1.md`](protocol-v1.md)

## Durable terminal authority

PostgreSQL decides every resignation, flag fall, no-show, abandonment, and
session-reset outcome. Each contender locks the game row, obtains one
`clock_timestamp()` observation, revalidates status and version, and updates
the terminal fields with an optimistic version guard.

The winning transaction persists the final clocks, result, termination, end
time, and one version increment. It also deletes both
`active_game_assignments` before commit. Losing or duplicate timer work becomes
a no-op after it observes the terminal status.

`game.resign` additionally stores its exact response under unique
`(game_id, event_id)` command identity. A retry by the same player returns that
response without a second transition or broadcast.

## Leaderless deadlines

Every application instance runs the same bounded deadline sweep at
`JOB_DEADLINE_SWEEP_MS`. PostgreSQL due-time queries cover:

- `join_deadline_at` while waiting for players;
- `turn_started_at + remaining clock` while playing or reconnecting;
- each disconnected player's `reconnect_grace_ends_at`.

Per-game Node.js timers reduce normal delivery latency. They are advisory:
startup rebuilds them from active PostgreSQL games; allocation, `game.ready`,
moves, disconnect/reconnect, and `game.sync` reschedule them; and the periodic
sweep remains the recovery guarantee. Timer callbacks always recompute the
clock under the game-row lock. Redis expiry notifications are not used.

Overdue work that cannot adjudicate, including uncertain Redis presence, is
retried at the sweep cadence rather than in a zero-delay loop.

## No-show and clock outcomes

At the join deadline:

- only white joined: white wins;
- only black joined: black wins;
- neither joined: void.

The durable status is `EXPIRED` and termination is `JOIN_TIMEOUT` in storage
(`no_show` on the wire).

Clocks continue while a game is `RECONNECTING`. A turn reaches flag fall at
exactly zero milliseconds. Timeout adjudication runs before abandonment when
both deadlines are due, so a durable flag fall can settle the game while a
player is absent.

## Disconnect and reconnect

Presence contains one Redis sorted-set member per socket. Closing one tab does
not affect the game while another unexpired member remains. When the last
socket disappears, one transaction:

1. records `disconnected_at` and `reconnect_grace_ends_at`;
2. sets the game to `RECONNECTING`;
3. recomputes the earliest game reconnect deadline;
4. increments the game version.

After commit, the server writes the disposable Redis grace key and emits
`player.disconnected` with `clocksContinue: true`.

An authenticated reconnect is first written into Redis presence, then clears
that player's durable disconnect fields under the game lock. The game returns
to `IN_PROGRESS` only when neither player remains disconnected. The server
emits `player.reconnected`, joins the recovered socket to the game room, and
sends `session.ready` followed by the authoritative `game.snapshot`.

At grace expiry, PostgreSQL eligibility and current Redis presence are both
checked. One absent player loses by abandonment; two absent players produce a
void double abandonment. If presence is unavailable, abandonment waits while
the PostgreSQL clock remains eligible to time out.

Resetting an active guest session bypasses grace and immediately abandons the
game in favor of the opponent before sockets are disconnected.

## Post-commit cleanup and delivery

Terminal cleanup is idempotent and runs only after durable commit:

- invalidate `game:{gameId}:snapshot`;
- delete both active-game and grace keys;
- remove matchmaking queue guards;
- set both user states to `IDLE`;
- emit `game.ended` through each player's personal room;
- cancel the local deadline timer;
- remove sockets from the game room after a bounded 250 ms delivery window.

Redis or event delivery failure cannot roll back a committed terminal result.
The cleanup entry point is safe for idempotent replay and later reconciliation.

## Verification

Run static, unit, coverage, and production build gates:

```bash
docker compose run --build --rm app npm run verify
```

Run the disposable real PostgreSQL/Redis and two-instance suite:

```bash
sh scripts/run-integration-tests.sh
```

The integration suite covers exact resignation replay, timeout, both no-show
outcomes, single and double abandonment, final-tab presence, reconnect
recovery, reset during play, terminal races, repeatable cleanup, process
restart recovery, and cross-instance lifecycle events.
