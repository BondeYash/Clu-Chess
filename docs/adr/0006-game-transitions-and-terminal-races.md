# ADR 0006: Game transitions, versions, and terminal race policy

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** F — Terminal and reconnection policies

## Context

No-show, disconnect, timeout, reset, resignation, and terminal-move handlers can race. User-visible outcomes and game versions must not depend on which instance runs a timer, and clients need a reliable monotonic state version.

## Decision

### Canonical enums

`GameStatus`:

- `CREATED`
- `WAITING_FOR_PLAYERS`
- `READY`
- `IN_PROGRESS`
- `RECONNECTING`
- `COMPLETED`
- `ABANDONED`
- `EXPIRED`

`Color`: `w`, `b`

`Result`: `white_win`, `black_win`, `draw`, `void`

`Termination`:

- `checkmate`
- `stalemate`
- `insufficient_material`
- `threefold_repetition`
- `fifty_move`
- `resignation`
- `timeout`
- `abandonment`
- `double_abandon`
- `no_show`

`UserMatchState`: `IDLE`, `QUEUED`, `RESERVED`, `IN_GAME`

### Durable deadlines and fleet presence

- `games.join_deadline_at` is written during allocation so no-show work survives Redis/process loss.
- Each `game_players` row has nullable `disconnected_at` and `grace_deadline_at`.
- The final live socket disappearing for a guest writes those fields and the `RECONNECTING` game transition together.
- Reconnect clears that player's disconnect/grace fields in the same transaction as the return to `IN_PROGRESS`.
- Redis presence is a per-guest sorted set whose members are `instanceId:socketId` and whose scores are expiry timestamps. The guest is absent only when no unexpired member remains.
- When Redis presence is unavailable/uncertain, grace adjudication waits rather than guessing. Durable clocks continue and may still resolve a timeout from PostgreSQL.

### State transitions and versions

`games.version` is the monotonic **game-state version**, not the ply count.

| Transition | Version behavior |
|---|---|
| creation through `WAITING_FOR_PLAYERS` in one allocation transaction | starts at `0` |
| `WAITING_FOR_PLAYERS → READY` | `+1` |
| `READY → IN_PROGRESS` | `+1` |
| accepted move remaining `IN_PROGRESS` | `+1` |
| terminal accepted move | `+1` once for move + terminal state |
| `IN_PROGRESS → RECONNECTING` | `+1` |
| `RECONNECTING → IN_PROGRESS` | `+1` |
| resignation, timeout, no-show, abandonment, or double abandonment | `+1` |
| cache/Redis/socket cleanup | no change |

Every durable transition locks the game row and updates with the previously read version as an optimistic guard. Events created by that transition carry the resulting version. `moves.ply_number` remains the independent contiguous move counter.

### Frozen outcomes

| Situation | Status | Result | Termination |
|---|---|---|---|
| White misses join deadline, black joined | `EXPIRED` | `black_win` | `no_show` |
| Black misses join deadline, white joined | `EXPIRED` | `white_win` | `no_show` |
| Neither player joins | `EXPIRED` | `void` | `no_show` |
| Legal checkmate | `COMPLETED` | winner by board | `checkmate` |
| Automatic rule draw | `COMPLETED` | `draw` | rule-specific reason |
| Player resigns | `COMPLETED` | opponent wins | `resignation` |
| Player's clock expires | `COMPLETED` | opponent wins | `timeout` |
| One player absent after grace | `ABANDONED` | opponent wins | `abandonment` |
| Both players absent when the first valid grace adjudication runs | `ABANDONED` | `void` | `double_abandon` |
| Session reset/logout while active | `ABANDONED` immediately | opponent wins | `abandonment` |

Clocks continue in `RECONNECTING`. A clock may therefore end the game before grace expiry.

### Race ordering

All contenders lock the game row and revalidate status/version.

- Move versus timeout uses ADR 0003's PostgreSQL `server_received_at`: at or after the deadline means timeout; before the deadline allows the move to continue.
- A terminal chess move records the move and terminal result in one update/version increment.
- For resignation, abandonment, no-show, or another non-clock terminal race, the first valid guarded terminal transaction to commit wins.
- A losing different command receives `GAME_ALREADY_ENDED` plus the authoritative terminal snapshot.
- A retry of the same command returns its recorded original outcome.
- Terminal transactions delete `active_game_assignments` atomically; Redis/socket cleanup follows commit and is retryable.

Durable non-move game commands use a `game_commands` table with `UNIQUE(game_id, event_id)`, command type, actor, result version, and a compact response payload. This supplies idempotent resignation and other client-triggered durable transitions.

## Invariants

- A game has exactly one terminal outcome.
- A game-state version is monotonic and changes for every durable externally visible transition.
- Ply numbers remain contiguous but are not assumed to equal game version.
- Explicit logout cannot gain a grace-period advantage.
- Timer duplication cannot produce a second result.
- Multiple tabs/replicas cannot cause one socket close to mark the guest absent.

## Consequences

- Clients must not derive ply number from `gameVersion`.
- Version gaps may represent moves or lifecycle transitions and always trigger `game.sync`.
- Disconnect events cause durable version changes and can make a pending client command stale.

## Verification

- Table-driven tests cover every legal and illegal transition.
- Race move/checkmate, move/timeout, resign/timeout, reconnect/abandonment, and double-disconnect.
- Assert one terminal row state, one result, zero active assignments, and one resulting event version.
- Retry each client terminal command and compare the original response.
