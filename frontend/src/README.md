# Source architecture

The App Router is a composition boundary. Route files select layouts and
feature compositions; they do not own transport or domain reducers.

```text
app/          route groups, layouts, metadata, loading and error boundaries
components/   shared presentation and shell components
config/       validated environment, feature flags and centralized constants
features/     vertical session, queue, game, learning and settings modules
hooks/        cross-feature React hooks only
lib/          framework-neutral helpers and configured third-party clients
services/     REST/realtime transports with no JSX
stores/       small client-only coordination and preferences
```

Each future feature owns its `components`, `hooks`, `model`, `queries`,
`schemas`, and tests. Shared components cannot import features. Services cannot
import JSX or navigation. Server state stays in TanStack Query; stores must not
duplicate complete query snapshots.
