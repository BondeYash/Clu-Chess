# Cluchess frontend

Phase 2 provides a high-fidelity, production-shaped Next.js App Router frontend
on port 5173. It includes the semantic CluChess design system, accessible
keyboard chessboard, responsive public and guest shells, Storybook, strict
TypeScript, Tailwind CSS, TanStack Query, Zod environment validation, Vitest,
Playwright, standalone container output, and the shared
`@cluchess/protocol-v1` package.

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

The current fixture routes are `/`, `/play`, `/game/demo`, `/learn`,
`/learn/king`, and `/settings`. Phase 2 deliberately makes no live feature API
calls; session and identity integration starts in Phase 3.

The frontend package is intentionally independent from backend runtime code.
Only the versioned transport package is shared.
