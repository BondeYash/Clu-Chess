# ADR F0001: Same-origin production edge

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend and platform engineering

## Context

The browser needs Next.js pages, credentialed REST, and Socket.IO. The backend
sets an HttpOnly `SameSite=Lax` guest cookie, validates an exact production
origin, and requires WebSocket upgrades or sticky polling fallback. Separate
public origins increase CORS, cookie, CSP, and operational failure modes.

## Decision

Expose one HTTPS application origin:

- normal paths and Next.js assets route to the frontend;
- `/v1/*` routes to the NestJS backend;
- `/socket.io/*` routes to the NestJS backend with upgrade support;
- `/metrics` and infrastructure readiness remain private.

The browser uses relative API/socket URLs in production. Local development is
the documented exception: Next.js runs on `http://localhost:5173`, the backend
runs on `http://localhost:3000`, and the existing backend allowlist admits the
frontend origin.

The edge must preserve request/response cookies, correlation headers, Socket.IO
upgrade headers, and polling affinity where polling is enabled.

## Rejected alternatives

- **Unrelated frontend/API sites:** rejected because `SameSite=Lax` cookie
  behavior and credentialed CORS become deployment-sensitive.
- **Proxy Socket.IO through a Next.js route handler:** rejected because the
  application server is not the WebSocket edge.
- **Frontend-only direct backend hostnames in production:** rejected because it
  duplicates public origin and certificate configuration.

## Consequences

- Browser configuration is simpler and production CORS becomes defense in
  depth.
- The platform owns path routing and WebSocket correctness.
- Static assets may be CDN cached, but guest REST/socket traffic may not.

## Verification

- Production-shaped smoke reaches pages, REST, and Socket.IO through one origin.
- Secure cookie survives create/renew and authenticates REST.
- WebSocket upgrade and polling fallback work across replicas.
- Public requests cannot reach `/metrics` or dependency details.
