import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_NAMES } from '../../src/modules/realtime/protocol/protocol.constants.js';

interface CollectionItem {
  readonly item?: readonly CollectionItem[];
  readonly request?: {
    readonly method: string;
    readonly url: { readonly raw: string };
  };
}

describe('Postman assets', () => {
  it('contains every HTTP endpoint exactly as an executable request', () => {
    const collection = readJson('postman/CluChess.postman_collection.json') as {
      readonly info: { readonly schema: string };
      readonly item: readonly CollectionItem[];
    };
    const requests = flattenRequests(collection.item);

    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    );
    expect(new Set(requests)).toEqual(
      new Set([
        'GET {{baseUrl}}/healthz',
        'GET {{baseUrl}}/readyz',
        'GET {{baseUrl}}/metrics',
        'POST {{baseUrl}}/v1/session',
        'GET {{baseUrl}}/v1/session',
        'POST {{baseUrl}}/v1/session/renew',
        'POST {{baseUrl}}/v1/session/reset',
        'GET {{baseUrl}}/v1/games/active',
        'GET {{baseUrl}}/v1/games/{{gameId}}/snapshot',
      ]),
    );
  });

  it('contains a native Socket.IO template for every client command', () => {
    const templates = readJson('postman/CluChess.socketio-events.json') as {
      readonly connection: {
        readonly ackRequired: boolean;
        readonly auth: { readonly token: string };
        readonly transport: string;
      };
      readonly events: readonly {
        readonly body: {
          readonly protocolVersion: number;
          readonly type: string;
        };
        readonly name: string;
      }[];
    };

    expect(templates.connection).toMatchObject({
      ackRequired: true,
      auth: { token: '{{tokenA}}' },
      transport: 'websocket',
    });
    expect(templates.events.map((event) => event.name).sort()).toEqual(
      [...CLIENT_EVENT_NAMES].sort(),
    );
    for (const event of templates.events) {
      expect(event.body).toMatchObject({
        protocolVersion: 1,
        type: event.name,
      });
    }
  });
});

function flattenRequests(items: readonly CollectionItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.request === undefined
      ? []
      : [`${item.request.method} ${item.request.url.raw}`]),
    ...flattenRequests(item.item ?? []),
  ]);
}

function readJson(path: string): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), path), 'utf8'),
  ) as unknown;
}
