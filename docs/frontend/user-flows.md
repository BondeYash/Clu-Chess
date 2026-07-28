# Frontend User Flows

> **Status:** Frozen for implementation
> **Authority:** [`../protocol-v1.md`](../protocol-v1.md) and accepted frontend
> ADRs

The diagrams show frontend orchestration. Server responses and snapshots remain
authoritative even when a local UI state has a similar name.

## 1. Guest bootstrap and active-game recovery

```mermaid
sequenceDiagram
    actor U as Visitor
    participant F as Frontend
    participant S as sessionStorage
    participant API as REST API
    participant WS as Socket.IO

    U->>F: Open /play or /game/:id
    F->>S: Read per-tab socket token
    alt token exists
        F->>API: GET /v1/session (Bearer + cookie)
        alt 401
            F->>S: Clear bearer token
            F->>API: GET /v1/session (cookie only, once)
        end
    else token missing
        F->>API: GET /v1/session (cookie only)
    end

    alt valid session and token exists
        API-->>F: guest
    else valid cookie but no token
        F->>API: POST /v1/session/renew (stable idempotency key)
        API-->>F: token + expiresAt
        F->>S: Store per-tab token
    else no valid session
        F->>API: POST /v1/session (stable idempotency key)
        API-->>F: token + guest
        F->>S: Store per-tab token
    end

    par connect realtime
        F->>WS: Connect auth.token
        WS-->>F: session.ready(activeGameId)
    and recover active assignment
        F->>API: GET /v1/games/active
        API-->>F: gameId or null
    end

    alt active game
        F->>F: replace /game/:id
        F->>API: GET /v1/games/:id/snapshot
        API-->>F: authoritative snapshot
    else no active game
        F-->>U: Reveal lobby
    end
```

### Rules

- The bootstrap coordinator is single-flight per tab.
- A bearer `401` cannot immediately create a new guest; cookie-only recovery is
  tried once.
- Create/renew retry uses the same idempotency key.
- `session.ready` and active-game REST disagreement triggers one fresh
  active-game read rather than a guessed route.

## 2. Lobby and matchmaking

```mermaid
sequenceDiagram
    actor U as Guest
    participant F as Lobby
    participant WS as Socket.IO

    U->>F: Choose Find a match
    F->>F: state = joining; disable duplicate input
    F->>WS: queue.join(eventId, blitz)
    alt acknowledgement success
        WS-->>F: queue.joined(since, position?)
        F->>F: state = queued; persist queue intent
    else ALREADY_IN_GAME
        WS-->>F: server.error
        F->>F: Recover active game
    else RATE_LIMITED or SERVICE_UNAVAILABLE
        WS-->>F: retryable error
        F-->>U: Inline wait/retry state
    end

    alt user cancels
        U->>F: Cancel search
        F->>WS: queue.leave(same attempt IDs on retry)
        WS-->>F: queue.left(requested)
        F->>F: Clear queue state and intent
    else match allocated
        WS-->>F: queue.left(matched)
        WS-->>F: match.found(gameId, version, color, opponent, deadline)
        F->>F: Clear queue; retain provisional match metadata
        F->>F: Navigate /game/:id
    end
```

### Reconnect rule

If the tab reconnects with queue intent but no active game, repeat
`queue.join`. The backend returns the existing queue state without duplicating
the queue member.

## 3. Match readiness and game start

```mermaid
sequenceDiagram
    actor U as Matched guest
    participant F as Game route
    participant WS as Socket.IO

    F-->>U: Show opponent, color, control, join countdown
    F->>WS: game.ready(gameId, match version)
    alt first player ready
        WS-->>F: Ack game.snapshot(WAITING_FOR_PLAYERS)
        F-->>U: Waiting for opponent
    else both ready
        WS-->>F: Ack game.snapshot(IN_PROGRESS)
        WS-->>F: game.started(version, clocks)
        F-->>U: Announce game started
    end

    opt lifecycle version gap
        F->>WS: game.sync(last known version)
        WS-->>F: Complete game.snapshot
    end
```

The join countdown is informative. The frontend never declares a no-show.

## 4. Move proposal, acknowledgement, and broadcast

```mermaid
sequenceDiagram
    actor U as Player
    participant B as Board UI
    participant R as Realtime reducer
    participant WS as Socket.IO

    U->>B: Select/drag piece and target
    B->>B: Show local legal hints
    opt promotion
        B-->>U: Promotion chooser
        U->>B: Choose q/r/b/n
    end
    B->>B: Create eventId + clientMoveId
    B->>B: Render pending overlay; block second local move
    B->>WS: move.submit(expectedVersion, from, to, promotion?)

    alt ack succeeds first
        WS-->>R: Ack move.accepted(version, ply, FEN, clocks)
        R->>B: Apply authoritative move once
        WS-->>R: Broadcast move.accepted
        R->>R: Dedupe by ply/version
    else broadcast succeeds first
        WS-->>R: Broadcast move.accepted
        R->>B: Apply authoritative move once
        WS-->>R: Ack move.accepted
        R->>R: Dedupe by ply/version
    else definitive rejection
        WS-->>B: move.rejected
        B->>B: Remove overlay; preserve authoritative board
        B-->>U: Announce mapped reason
    else acknowledgement timeout
        B->>WS: Retry same eventId + clientMoveId
        alt still uncertain
            B->>WS: game.sync
            WS-->>R: Complete snapshot
            R->>B: Replace authoritative game; clear pending
        end
    end
```

Client `chess.js` supplies target hints only. The backend determines legality,
turn, check, clocks, and result.

## 5. Version gap and snapshot recovery

```mermaid
flowchart TD
    A[Parsed game event] --> B{Full snapshot?}
    B -- Yes --> C{Older than a higher version already applied?}
    C -- Yes --> D[Discard raced response and sync again]
    C -- No --> E[Replace game cache]
    B -- No --> F{Seen event ID or move ply?}
    F -- Yes --> G[Ignore duplicate]
    F -- No --> H{Compare event version}
    H -- Lower --> I[Ignore stale incremental event]
    H -- Equal --> J[Apply only documented companion semantics]
    H -- Local + 1 --> K[Apply pure reducer]
    H -- Greater than Local + 1 --> L[Mark syncing; keep safe board read-only]
    L --> M[Emit game.sync]
    M --> N{Ack succeeds?}
    N -- Yes --> E
    N -- No --> O[HTTP snapshot fallback]
    O --> E
```

## 6. Disconnect and reconnect

```mermaid
sequenceDiagram
    actor U as Player
    participant F as Frontend
    participant WS as Socket.IO
    participant API as REST API

    WS-->>F: transport disconnected
    F-->>U: Keep last safe board; show reconnecting
    Note over F: Clocks continue from last server base

    alt transport reconnects
        F->>WS: Re-authenticate with current token
        WS-->>F: session.ready(activeGameId)
        WS-->>F: game.snapshot
        F-->>U: Clear transport banner
    else token missing but cookie valid
        F->>API: Renew with stable key
        API-->>F: new token
        F->>WS: Reconnect
    else socket recovery fails
        F->>API: GET game snapshot
        API-->>F: snapshot or typed error
    end

    opt opponent's final socket disconnects
        WS-->>F: player.disconnected(graceDeadline, clocksContinue=true)
        F-->>U: Show grace state without pausing clock
    end

    opt opponent reconnects
        WS-->>F: player.reconnected
        WS-->>F: game.snapshot
        F-->>U: Clear opponent grace state
    end
```

## 7. Terminal game

```mermaid
flowchart TD
    A[Live or reconnecting game] --> B{Terminal source}
    B -->|Move| C[move.accepted]
    B -->|Resign| D[game.resign ack]
    B -->|Clock/no-show/abandonment| E[game.ended event]
    C --> F[Optional equal-version game.ended]
    D --> G[Apply terminal payload]
    E --> G
    F --> G
    G --> H[Final FEN and clocks]
    H --> I[Map result + termination to plain language]
    I --> J[Set active game null]
    J --> K[Result sheet: return to lobby]
    I --> L{PGN received in this tab?}
    L -- Yes --> M[Enable copy/download]
    L -- No --> N[Do not show unavailable action]
```

The frontend does not infer terminal state from a displayed zero clock or
client chess engine.

## 8. Identity reset

```mermaid
sequenceDiagram
    actor U as Guest
    participant F as Settings
    participant API as REST API
    participant WS as Socket.IO
    participant S as Browser storage/cache

    U->>F: Start with a new identity
    alt active game
        F-->>U: Warn: reset immediately abandons the game
    else no active game
        F-->>U: Warn: identity cannot be recovered
    end
    U->>F: Confirm
    F->>API: POST /v1/session/reset (stable key)
    alt success
        API-->>F: ok
        F->>WS: Disconnect
        F->>S: Clear token, pending keys, queue intent, Query and guest stores
        F->>F: replace /
    else retryable failure
        API-->>F: error + correlation ID
        F-->>U: Keep dialog state; retry same key
    else definitive failure
        API-->>F: error
        F-->>U: Explain and offer safe exit
    end
```

## Cross-flow invariants

- Never enable two concurrent local move submissions.
- Never retry a semantic command with new identifiers.
- Never erase a safe board because the network is unavailable.
- Never expose raw backend error codes as primary user copy.
- Never create a new guest merely because a socket connection failed.
- Never treat a route guard or cached active-game ID as authorization.
- Every uncertain state converges through sync, HTTP snapshot, or explicit user
  recovery.
