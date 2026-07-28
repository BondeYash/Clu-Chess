# PostgreSQL Operations and Migration Policy

> **Status:** Phase 2 baseline
> **Applies to:** every shared environment and production deployment

## Role separation

CluChess uses distinct credentials for schema changes and application traffic.
Neither credential is a PostgreSQL superuser.

| Role              | Permitted                                                                                      | Forbidden                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Migration         | Connect, schema usage/create, DDL, migration history, table/sequence/function ownership        | Superuser, role administration, use by app replicas                      |
| Runtime           | Connect, schema usage, CRUD on application tables, sequence usage, approved function execution | Schema create, alter/drop, role administration, migration history writes |
| Provisioner/owner | Initial database/role provisioning and emergency operator work                                 | Routine application or migration traffic                                 |

`DATABASE_URL` always identifies the runtime role.
`MIGRATION_DATABASE_URL` is supplied only to the gated migration job. Prisma
prefers it for migration commands and falls back to `DATABASE_URL` only for
isolated tests. The local Docker stack creates equivalent development-only roles
automatically; no developer has to provision them or create an environment file.

Production grants must be managed by infrastructure code. New migrations that
create tables, sequences, or functions must inherit default runtime grants from
the migration role. A release smoke test must connect with the runtime
credential, not the owner credential.

## Migration deployment gate

Migrations do not run in an application replica. The release pipeline performs:

1. take or verify a recent recoverable backup and PITR health;
2. run `prisma migrate status` with the migration role;
3. review the SQL for table rewrites, long locks, and destructive changes;
4. run `prisma migrate deploy` once as a gated job;
5. run `prisma migrate status` again and verify runtime-role readiness;
6. deploy application replicas only after the migration job succeeds.

A failed migration blocks the application rollout. Applied migration files are
immutable: a correction is always a new forward migration.

## Expand/contract changes

Every zero-downtime schema change spans compatible releases:

1. **Expand:** add nullable columns, new tables, concurrent indexes, or
   non-validating constraints without removing anything the current app reads.
2. **Backfill:** update bounded batches with progress and replication-lag
   monitoring. Backfills do not run inside the application startup path.
3. **Switch:** deploy code that reads the new shape and, where necessary,
   dual-writes old and new fields.
4. **Validate:** validate deferred constraints and prove old readers/writers are
   no longer active.
5. **Contract:** remove the old field, index, or behavior in a later release.

Large indexes use `CREATE INDEX CONCURRENTLY` in a migration explicitly marked
non-transactional. New required fields are introduced nullable or with a safe
constant default, backfilled, validated, and only then made `NOT NULL`. Renames
use add/copy/switch/remove rather than an in-place breaking rename.

Before production, the migration owner must record expected lock level, expected
duration at current table size, cancellation behavior, and the compatible app
versions. PostgreSQL `lock_timeout` and `statement_timeout` must be bounded for
operator-run DDL.

## Rollback policy

Production rollback never depends on destructive down migrations.

- If the new app fails but the schema is backward compatible, roll application
  replicas back and leave the expanded schema in place.
- If a migration is defective, stop the rollout and apply a reviewed fix-forward
  migration.
- Never drop a column/table or reverse a data transformation merely to roll back
  application code.
- Restore from backup/PITR only for confirmed corruption or destructive data
  loss, not as an ordinary release rollback.

The Phase 2 migration is additive to the Phase 1 empty baseline. Its deferred
allocation triggers and checks are part of the durable contract and must not be
disabled to work around an application bug.

## Backup and restore expectations

Production PostgreSQL must provide encrypted automated backups plus continuous
WAL archiving/PITR. The initial service objectives are:

- restore point objective: at most five minutes of committed data;
- restore time objective: service recovery within sixty minutes;
- PITR retention: at least seven days, with longer retention set by product and
  regulatory needs;
- backups encrypted at rest and in transit, access audited, and kept outside the
  failure domain of the primary database.

A restore is considered valid only after a separate database is restored and:

1. PostgreSQL starts without recovery errors;
2. `prisma migrate status` reports the expected history;
3. table counts and sampled game/move aggregates pass consistency checks;
4. deferred allocation constraints can be forced with
   `SET CONSTRAINTS ALL IMMEDIATE`;
5. the application connects with the runtime role and passes readiness/recovery
   smoke tests.

Run a restore drill before first production launch and at least quarterly
thereafter. Record backup identifier, requested restore timestamp, achieved RPO
and RTO, validation output, and follow-up actions.

## Local and CI verification

Docker is the only external prerequisite:

```bash
sh backend/scripts/run-integration-tests.sh
```

Vitest uses Testcontainers to start pinned PostgreSQL and Redis containers,
deploys the full migration history, and destroys them after the suite. Tests
cover a clean database, an in-place Phase 1 upgrade, migration status/drift,
constraints, transaction rollback, duplicate commands, and concurrent active
assignment races.

The normal local stack is still zero-touch:

```bash
docker compose up --build
```

The one-shot `migrate` service uses the migration role. The long-running `app`
service receives only the runtime role. If the role bootstrap or migration
changes, reset only the project-scoped local volumes with
`sh backend/scripts/reset-local-docker.sh`.
