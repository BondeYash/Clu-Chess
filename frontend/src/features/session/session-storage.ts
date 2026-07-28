export type SessionOperation = 'create' | 'renew' | 'reset';

const PREFIX = 'cluchess:v1';
const ACTIVE_GAME_KEY = `${PREFIX}:active-game-hint`;
const TOKEN_KEY = `${PREFIX}:socket-token`;
const OPERATION_KEYS: Record<SessionOperation, string> = {
  create: `${PREFIX}:pending:create`,
  renew: `${PREFIX}:pending:renew`,
  reset: `${PREFIX}:pending:reset`,
};

export interface SessionStoragePort {
  clearActiveGameHint(): void;
  clearAll(): void;
  clearOperation(operation: SessionOperation): void;
  clearToken(): void;
  getActiveGameHint(): string | null;
  getOrCreateOperationKey(operation: SessionOperation): string;
  getToken(): string | null;
  setActiveGameHint(gameId: string | null): void;
  setToken(token: string): void;
}

export function createSessionStorageAdapter({
  createId = () => crypto.randomUUID(),
  storage = resolveSessionStorage(),
}: {
  createId?: () => string;
  storage?: Storage | undefined;
} = {}): SessionStoragePort {
  const memory = new Map<string, string>();
  let memoryToken: string | null = null;

  function read(key: string): string | null {
    const remembered = memory.get(key);
    if (remembered !== undefined) return remembered;
    try {
      const value = storage?.getItem(key) ?? null;
      if (value !== null) memory.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  function write(key: string, value: string): void {
    memory.set(key, value);
    try {
      storage?.setItem(key, value);
    } catch {
      // Memory remains the safe fallback when storage is unavailable.
    }
  }

  function remove(key: string): void {
    memory.delete(key);
    try {
      storage?.removeItem(key);
    } catch {
      // Nothing else is required for unavailable storage.
    }
  }

  return {
    clearActiveGameHint() {
      remove(ACTIVE_GAME_KEY);
    },
    clearAll() {
      memoryToken = null;
      remove(TOKEN_KEY);
      remove(ACTIVE_GAME_KEY);
      for (const key of Object.values(OPERATION_KEYS)) remove(key);
    },
    clearOperation(operation) {
      remove(OPERATION_KEYS[operation]);
    },
    clearToken() {
      memoryToken = null;
      remove(TOKEN_KEY);
    },
    getActiveGameHint() {
      return read(ACTIVE_GAME_KEY);
    },
    getOrCreateOperationKey(operation) {
      const key = OPERATION_KEYS[operation];
      const existing = read(key);
      if (existing) return existing;
      const created = createId();
      write(key, created);
      return created;
    },
    getToken() {
      if (memoryToken) return memoryToken;
      memoryToken = read(TOKEN_KEY);
      return memoryToken;
    },
    setActiveGameHint(gameId) {
      if (gameId) write(ACTIVE_GAME_KEY, gameId);
      else remove(ACTIVE_GAME_KEY);
    },
    setToken(token) {
      memoryToken = token;
      write(TOKEN_KEY, token);
    },
  };
}

function resolveSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const sessionStorageAdapter = createSessionStorageAdapter();
