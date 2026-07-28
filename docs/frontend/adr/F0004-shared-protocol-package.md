# ADR F0004: Shared transport-only protocol package

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend and backend engineering

## Context

Protocol v1 already has backend Zod schemas. Copying them into the frontend
would permit silent drift, while importing NestJS source would couple browser
code to backend internals.

## Decision

Phase 1 creates `packages/protocol-v1`, a private transport-only package with no
NestJS, Prisma, Node-only, React, or browser-only imports.

It exports:

- scalar/enumeration definitions;
- HTTP success/error schemas and inferred types;
- strict client command schemas;
- strict server emission and acknowledgement schemas;
- tolerant client-receive schemas that validate known v1 fields while
  ignoring additive unknown server fields;
- version and event-name constants;
- shared contract fixtures.

The backend stays strict for inbound client objects. The frontend remains
forward compatible with optional server additions.

## Rejected alternatives

- **Duplicate schemas:** rejected due to drift risk.
- **Generate TypeScript types only:** rejected because runtime boundary
  validation remains necessary.
- **Import backend modules from `src/`:** rejected due to coupling and browser
  bundle risk.
- **OpenAPI alone:** insufficient for Socket.IO envelopes and acknowledgements.

## Consequences

- Extracting schemas touches backend imports and must preserve its full verify
  suite.
- The package version follows protocol compatibility, not UI release cadence.
- A temporary duplication exception requires CI fixture comparison and a dated
  removal owner.

## Verification

- Backend and frontend contract tests consume the same fixtures.
- Browser bundle inspection contains no NestJS/Prisma/Node shims.
- Every documented route, command, event, ack, and error code is exported.
- Unknown optional server fields pass client receive validation; unknown client
  fields fail backend validation.
