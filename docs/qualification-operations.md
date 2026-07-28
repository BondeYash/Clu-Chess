# End-to-end and Load Qualification

> **Status:** Phase 12 implementation contract
> **Release rule:** correctness failures always block; release-scale performance
> claims require artifacts from the exact candidate revision

## Zero-touch qualification topology

All dependencies and load tooling run in Docker. The qualification overlay
starts PostgreSQL, Redis, two production application containers, and the same
TLS/WSS Nginx routing model used by the multi-instance smoke. It adds:

- an isolated Artillery 2.0.33 image with a locked dependency graph;
- a metrics and correctness client on the internal Docker network;
- continuous application, PostgreSQL, Redis, and Nginx sampling;
- host-side Docker resource sampling;
- a qualification-only load-generator connection allowance.

The qualification Nginx file raises the per-source-IP connection limit because
all virtual users originate from one Docker address. The normal
`docker/nginx/nginx.conf` remains limited to 20 connections per client IP. No
production security setting is silently relaxed.

Run the repeatable crash, dependency, and load smoke gate:

```bash
npm --prefix backend run test:qualification:docker
```

No `.env`, keys, database, Redis, Artillery, or host service setup is required.
Every run uses an isolated Compose project and removes its containers and
volumes on exit. Evidence is retained under `.artifacts/phase12/`.

## Failure qualification

`backend/scripts/phase12-failure-qualification.mjs` performs a live
two-replica flow:

1. creates guests pinned across both replicas;
2. matches and starts one game;
3. sends `SIGKILL` to the replica owning one live socket;
4. reconnects that guest through Nginx to the surviving replica and requires a
   recovered snapshot;
5. restarts the failed replica and waits for readiness;
6. plays Fool's Mate to a durable checkmate;
7. stops PostgreSQL and then Redis, requiring liveness to remain up, readiness
   to fail closed, and readiness to recover after each dependency returns;
8. runs the SQL and Redis correctness audits;
9. captures app, datastore, load-balancer, container, version, and rendered
   configuration evidence.

Assertions use bounded event or readiness polling. There are no fixed sleeps
that assume a dependency or transition completed.

## Artillery profiles

The TypeScript Artillery definition uses an ESM processor because every virtual
user must create a unique guest session before placing that JWT in the
Socket.IO `auth` handshake. Each user tracks authoritative game versions and
uses a unique UUID v4 `clientMoveId`.

| Command                    | Arrival model                                     | Behavior                                                                 |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm --prefix backend run test:load:docker` | 4 users in 1 second                               | CI/local checkmate smoke                                                 |
| `npm --prefix backend run test:load:target` | 2,000 users over 5 minutes, 15-minute VU lifetime | About 1,000 games, queue churn, openings, checkmates, 15% hard reconnect |
| `npm --prefix backend run test:load:stress` | 2,500 sockets over 5 minutes, 15-minute lifetime  | Authenticated physical-socket headroom                                   |
| `npm --prefix backend run test:load:burst`  | 1,000 users over 10 seconds                       | 500-game scripted move burst                                             |
| `npm --prefix backend run test:load:soak`   | 200 users over 5 minutes, 60-minute lifetime      | Lower-volume leak and stale-state soak                                   |
| `npm --prefix backend run test:load:full`   | target, stress, then burst                        | Pre-release capacity qualification                                       |

The target profile keeps the earliest virtual users connected for 15 minutes.
After the five-minute arrival ramp, all 2,000 sockets overlap for ten minutes.
Non-checkmate games use a six-ply legal Ruy Lopez opening and remain active;
five percent use a four-ply known checkmate. Queue-churn users leave after a
stable randomized wait, unless already matched, in which case they complete
the game protocol. Fifteen percent of game users hard-disconnect and reconnect
within the configured grace period.

## Evidence and gates

Each load run retains:

- the aggregate and interval Artillery JSON report;
- threshold validation output;
- continuous internal metrics samples;
- before, load-end, and post-drain metric snapshots;
- continuous Docker CPU/memory/network/block-I/O samples;
- SQL and Redis audit results;
- tool, image, application revision, and rendered Compose configuration;
- bounded logs on failure.

The validator enforces:

- no failed virtual users or socket engine errors;
- session-create p95 at or below 150 ms;
- TLS/WSS connect p95 at or below 300 ms;
- waiting-opponent match p95 at or below 500 ms;
- server move validation/persistence p95 at or below 50 ms;
- commit-to-broadcast p95 at or below 50 ms;
- reconnect plus snapshot p95 at or below 800 ms when reconnects occur;
- expected socket and active-game concurrency for target/stress profiles;
- a 500 committed-move/second burst for the burst profile;
- bounded Redis stream and database connections;
- zero Redis rejected connections or evictions.

The smoke run treats matchmaking and client-observed move latency as advisory
because four samples do not constitute a release performance claim. Server
histograms, datastore audits, and correctness checks still block.

`backend/scripts/qualification-audit.mjs` checks:

- unique `(game_id, client_move_id)` and contiguous ply;
- `game.version >= accepted move count`, with the non-negative delta reserved
  for the approved lifecycle transitions in ADR 0006;
- command result versions never ahead of the game;
- exactly two distinct guests and colors;
- one active assignment per guest and only against active games;
- valid terminal outcomes and absent non-terminal outcomes;
- consistent Redis reservations, queue guards, active-game hints, user states,
  and reconnect-grace keys;
- a Socket.IO adapter stream length at or below 10,000.

The SQL version audit intentionally does not compare `version` directly with
ply. Ready, disconnect, reconnect, resignation, timeout, and abandonment are
approved non-move transitions that increment the same optimistic version.

## Release decision

GitHub Actions runs the crash/dependency suite and smoke profile on every
change and uploads the evidence even when the job fails. Before a production
release, run `test:load:full` and `test:load:soak` on the release candidate and
retain both artifact directories with the release.

An unmet correctness invariant, duplicate move, double assignment, invalid
outcome, or unbounded state is never an accepted exception. A performance
exception must identify the measured bottleneck, owner, follow-up issue, and
retest criterion in [qualification-exceptions.md](qualification-exceptions.md).
