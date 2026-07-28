# ADR F0007: Nonce CSP and rendering tradeoff

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend, security, and platform engineering

## Context

The active tab holds a JavaScript-readable socket JWT. A strict Content Security
Policy materially reduces script-injection risk. Current Next.js nonce handling
requires request-time rendering for affected HTML and trades away static HTML
generation.

## Decision

- Generate a per-response nonce in the current Next.js `proxy.ts`.
- Enforce a nonce-based CSP on application HTML after a report-only burn-in.
- Production excludes `unsafe-eval`.
- `connect-src` admits only self and the explicitly configured telemetry
  endpoint.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and
  `frame-ancestors 'none'` are mandatory.
- Self-host fonts, icons, pieces, avatars, and lesson media.
- Do not use `dangerouslySetInnerHTML` for lesson content.
- Accept request-rendered HTML while nonce CSP is required. Compile lesson/legal
  content at build time, but render it through the nonce-bearing server shell.
- Do not depend on experimental SRI for the release security boundary.

## Rejected alternatives

- **`unsafe-inline` production scripts:** rejected for the token-bearing origin.
- **Experimental SRI as release authority:** rejected until stable and supported
  by the chosen build pipeline.
- **No CSP because identities are anonymous:** rejected because a stolen token
  can still manipulate an active game/identity.
- **Disable JavaScript-readable token without backend change:** incompatible
  with Socket.IO v1 `auth.token`.

## Consequences

- HTML rendering and cache costs must be measured in later phases.
- Fingerprinted static assets remain CDN-cacheable.
- Marketing/lesson content stays server-component based but not static HTML
  while nonce enforcement applies.

## Verification

- Report-only telemetry reaches zero unexplained violations.
- Production response carries a fresh nonce and enforced CSP.
- XSS fixture and inline-script attempts are blocked.
- Page, image, font, REST, socket, and telemetry requests still work.
