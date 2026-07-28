# Frontend Phase 1 Acceptance

> **Status:** Accepted
> **Date:** 2026-07-28
> **Roadmap:** [`../../FRONTEND_PLAN.md`](../../FRONTEND_PLAN.md)

## Delivered foundation

- `frontend/` is an independent Next.js 16 App Router package pinned to the
  repository's Node 24/npm 11 runtime policy.
- TypeScript strict mode, exact optional properties, unchecked-index
  protection, aliases, ESLint, Prettier, Tailwind CSS 4, Vitest, Playwright,
  TanStack Query, Zustand, and the bundle analyzer are configured.
- `/`, `/play`, route loading, root/global errors, and the product 404 state
  compile as static App Router routes. `/play` is deliberately health-neutral.
- Public environment variables fail fast through Zod. Production rejects
  insecure origins, developer tools, protocol mismatch, and secret-shaped
  `NEXT_PUBLIC_` keys.
- `packages/protocol-v1` owns framework-neutral HTTP and realtime schemas.
  Backend command/emission schemas remain strict; browser receive schemas strip
  additive fields recursively.
- Existing backend schema import paths are compatibility re-exports from the
  shared package. Backend controllers, gateways, and tests therefore consume
  the same artifact without a wire-contract change.
- The frontend Dockerfile has dependency, development, build, and non-root
  standalone production stages. Compose adds `web` and its volume-permission
  initializer while retaining the backend service topology.
- Frontend quality, Chromium E2E, and production-container jobs are isolated in
  CI from the existing backend jobs.
- Dependabot tracks the backend, frontend, protocol package, Docker, and GitHub
  Actions on independent weekly update streams.

## Acceptance evidence

| Gate | Result |
| --- | --- |
| Shared package verification | 1 file, 6 contract tests passed; typecheck and build passed |
| Frontend unit/component/contract suite | 3 files, 10 tests passed |
| Frontend coverage | 96.55% statements, 92.85% branches, 100% functions |
| Environment matrix | Local defaults, secure production, insecure production, protocol mismatch, and public-secret cases passed |
| Next production build | `/`, `/play`, 404, manifest, and robots generated successfully |
| Chromium E2E | Public route, direct `/play` deep link, and product 404 passed |
| Dependency audit | 0 known vulnerabilities after pinned transitive overrides |
| Frontend production image | Built on Node 24; configured user is `node`; read-only smoke returned 200 for `/` and `/play` |
| Backend regression | 18 files and 123 tests passed with existing coverage gates; lint, typecheck, protocol verification, and build passed |
| Backend production image | Built successfully and resolved protocol v1 at runtime as user `node` |
| Compose model | Configuration parsed; complete stack reached healthy backend and live frontend; REST CORS preflight returned the configured frontend origin |

The Compose rehearsal used host ports `13000` and `15174` because another local
Next process already occupied port 3000. The container ports and documented
defaults remain backend `3000` and frontend `5173`; the same rehearsal verified
the supported origin override path.

## Acceptance criteria

- [x] `docker compose up --build` is the documented single command for the
      complete local stack.
- [x] Next listens on container/local port 5173, and the backend default origin
      allowlist includes `http://localhost:5173`.
- [x] Backend and frontend consume `@cluchess/protocol-v1`.
- [x] The production web container runs as non-root and passes a read-only
      filesystem smoke test.
- [x] Frontend CI is isolated from backend CI.
- [x] Backend qualification behavior remains green after extraction.

Phase 2 may now build the design system and responsive shell on this
foundation.
