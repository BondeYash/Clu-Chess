# Cluchess frontend

Phase 1 provides a production-shaped Next.js App Router foundation on port 5173. It includes strict TypeScript, Tailwind CSS, TanStack Query, Zod
environment validation, Vitest, Playwright, standalone container output, and
the shared `@cluchess/protocol-v1` package.

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

The frontend package is intentionally independent from backend runtime code.
Only the versioned transport package is shared.
