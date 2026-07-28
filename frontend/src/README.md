# Source architecture

The App Router is a composition boundary. Route files select layouts and
feature compositions; they do not own transport or domain reducers.

```text
app/          route groups, layouts, metadata, loading and error boundaries
components/   shared presentation and shell components
config/       validated environment, feature flags and centralized constants
features/     vertical session, queue, game, learning and settings modules
hooks/        cross-feature React hooks only
lib/          API boundary, query keys and framework-neutral helpers
services/     cross-feature realtime transports with no JSX
stores/       small client-only coordination and preferences
```

Each feature owns its presentation, coordinator, endpoint adapter, storage
adapter, and colocated tests when those concerns are feature-specific. Shared
components cannot import features except at explicit shell composition
boundaries. Transport modules cannot import JSX or navigation. Server state
stays in TanStack Query; stores must not duplicate complete query snapshots.

The session feature deliberately returns a public identity view model without
the bearer token. The token and pending idempotency keys remain behind its
`SessionStoragePort`, backed by per-tab `sessionStorage` with an in-memory
fallback.
