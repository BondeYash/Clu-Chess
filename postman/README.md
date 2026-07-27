# CluChess Postman assets

Import:

1. `CluChess.postman_collection.json`
2. `CluChess.local.postman_environment.json`

Start the normal local stack with `docker compose up --build`, select
**CluChess Local Docker**, then run **00 - Operations** and
**01 - Session Bootstrap**. The create requests store both guest JWTs locally
as collection variables.

For realtime testing, create two native **Socket.IO** requests in Postman:

- URL: `{{socketUrl}}`
- transport: WebSocket
- header: `Origin: {{allowedOrigin}}`
- Auth object for client A: `{ "token": "{{tokenA}}" }`
- Auth object for client B: `{ "token": "{{tokenB}}" }`
- Ack: enabled for every sent event

Copy the exact event names and bodies from `CluChess.socketio-events.json`.
Join both guests to obtain `match.found`, copy its `gameId` and `gameVersion`
into the collection variables, then send `game.ready` from both clients.
After that, the recovery snapshot request and the remaining game commands are
ready to use.

Use a fresh UUID v4 for every new `eventId` and `clientMoveId`. Reuse an ID
only to test an exact idempotent retry.

Postman currently stores Socket.IO requests in a multi-protocol collection,
which cannot contain HTTP requests and cannot be exported. That is why the
portable repository assets are an importable HTTP Collection v2.1 plus exact
Socket.IO templates:

- <https://learning.postman.com/docs/use/use-collections/add-requests-to-collections>
- <https://learning.postman.com/docs/getting-started/importing-and-exporting/exporting-data>
