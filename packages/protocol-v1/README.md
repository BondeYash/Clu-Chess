# @cluchess/protocol-v1

Framework-neutral Zod schemas and transport types shared by the Cluchess
backend and frontend.

- Backend command and emission schemas are strict at every object boundary.
- Browser receive schemas use the `client*` prefix and strip additive fields.
- The package imports no NestJS, Prisma, React, browser, or Node runtime APIs.
- Any breaking transport change requires a new versioned package.

Run `npm run verify` from this directory before publishing contract changes.
