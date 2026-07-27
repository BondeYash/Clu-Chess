# Security Operations

## Implemented boundary controls

The production path is HTTPS/WSS only. Nginx terminates TLS 1.2 or 1.3, rejects
unapproved Socket.IO origins, caps request bodies at 8 KiB, and limits each
source address to 20 concurrent socket connections. The application repeats
the exact-origin and secure-forwarded-protocol checks so bypassing the edge does
not bypass the policy.

Socket.IO also enforces:

- an 8 KiB inbound packet ceiling;
- an atomic Redis connection registry per hashed client address;
- atomic fixed-window Redis counters for queue, move, sync, session, and
  recovery commands;
- a 64-packet outgoing Engine.IO buffer ceiling, after which the socket is
  disconnected and recovers through an authoritative snapshot;
- EdDSA token verification and revocation checks before identity is attached;
- Zod validation before dispatch;
- durable membership authorization on every game read or mutation;
- durable event/client-move idempotency for replayed mutations.

The edge limit is intentionally defense in depth. The Redis connection registry
is fleet-wide and remains authoritative when traffic moves between replicas.

## Rate-limit dependency policy

| Boundary                                      | Redis unavailable policy | Reason                                                            |
| --------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| Session creation, renew, reset                | fail closed              | Prevents unbounded identity/token issuance and reset ambiguity    |
| Handshake connection cap and token revocation | fail closed              | Authentication and connection admission cannot be safely bypassed |
| Matchmaking                                   | fail closed              | Queue correctness itself depends on Redis                         |
| Authenticated move/queue/sync counters        | fail open                | PostgreSQL authorization/idempotency remains authoritative        |
| Authenticated recovery counters               | fail open                | Recovery must remain available while durable state is healthy     |

All rate-limit identifiers are SHA-256 digests or authenticated guest IDs in
short-lived Redis keys. They are never written to PostgreSQL or metric labels.

## Secrets and datastore transport

Real production configuration rejects PostgreSQL without credentials and
`sslmode=require` (or stronger), and rejects Redis unless it uses authenticated
`rediss://`. `ALLOW_INSECURE_LOCAL_PRODUCTION=true` exists solely for the
isolated Docker production-image test topology.

JWT private keys and the metrics scrape bearer token are file-mounted secrets.
They are not accepted as raw key values in application configuration. A
deployment secret manager must populate the configured paths. Logs redact
authorization, cookies, tokens, JTIs, passwords, private keys, and datastore
URLs.

The database has separate roles:

- `cluchess_migrator` owns schema changes and runs the gated migration job;
- `cluchess_runtime` has data access only and cannot create schema objects;
- neither role is a superuser or can create roles/databases.

Local-only passwords in Compose are disposable and must never be reused.

## Container controls

The production image runs as the unprivileged `node` user and contains only
production dependencies plus `tini`. The multi-instance deployment additionally
uses a read-only root filesystem, a bounded `/tmp` tmpfs, drops every Linux
capability, and enables `no-new-privileges`.

The public edge returns `404` for `/metrics`. Internal Prometheus scraping
requires a constant-time checked bearer token read from the generated secret
volume.

## Security verification

Run all local security gates through Docker:

```bash
npm run test:security:docker
```

The gate builds the production image, scans the repository with Gitleaks, scans
dependencies/IaC/secrets/licenses with Trivy, scans the final image for
high/critical fixed vulnerabilities and secrets, and boots the image with a
read-only filesystem.

CI also runs `npm audit --audit-level=high`. GPL-2.0, GPL-3.0, and AGPL-3.0 are
forbidden for shipped dependencies unless the project owner explicitly changes
the license policy after legal review.
