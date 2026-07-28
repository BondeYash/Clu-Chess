# Cluchess frontend

Phase 4 provides a high-fidelity, production-shaped Next.js App Router frontend
on port 5173 with a live anonymous-session lifecycle, a lazy authenticated
Socket.IO transport, and authoritative game recovery. It includes the semantic
CluChess design system, accessible keyboard chessboard, responsive public and
guest shells, a typed REST and realtime boundary, bounded idempotent session
recovery, reconnect reconciliation, Storybook, strict TypeScript, Tailwind CSS,
TanStack Query, Zod validation, Zustand transport state, Vitest, Playwright,
standalone container output, and the shared `@cluchess/protocol-v1` package.

## Local development

From the repository root, start the complete stack:

```sh
docker compose up --build
```

Then open <http://localhost:5173>. The backend remains available at
<http://localhost:3000>.

For frontend-only work, first build the protocol package and then start Next:

```sh
npm --prefix packages/protocol-v1 ci
npm --prefix packages/protocol-v1 run build
npm --prefix frontend ci
npm --prefix frontend run dev
```

Copy `.env.example` to `.env.local` only when overriding the safe local
defaults. Public variables are validated at build/startup; secret-shaped
`NEXT_PUBLIC_` keys are rejected.

## Verification

```sh
npm --prefix packages/protocol-v1 run verify
npm --prefix frontend run verify
npm --prefix frontend run test:e2e
```

The current routes are `/`, `/play`, `/game/demo`, `/game/:gameId`, `/learn`,
`/learn/king`, and `/settings`. `/play`, `/settings`, and game routes are
guest-gated and consume the live session APIs. A UUID game route recovers an
authoritative snapshot and opens one authenticated realtime connection; the
demo and non-game routes keep the Socket.IO bundle deferred. The landing page
performs cookie recovery without creating a guest until the visitor chooses a
guest route.

Session tokens and retry keys are per-tab values in `sessionStorage`; they must
never be placed in URLs, logs, TanStack Query, `localStorage`, or IndexedDB. The
full runtime and recovery contract is documented in
[`../docs/frontend/session-lifecycle.md`](../docs/frontend/session-lifecycle.md)
and
[`../docs/frontend/realtime-recovery.md`](../docs/frontend/realtime-recovery.md).

The frontend package is intentionally independent from backend runtime code.
Only the versioned transport package is shared.
