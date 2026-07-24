import { Prisma } from '../../generated/prisma/client.js';

export type DatabaseErrorKind =
  'constraint' | 'retryable' | 'unavailable' | 'unique' | 'unknown';

export class DatabaseError extends Error {
  constructor(
    readonly kind: DatabaseErrorKind,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(`Database operation failed (${kind})`, options);
    this.name = 'DatabaseError';
  }
}

interface ErrorWithCode {
  code?: unknown;
  cause?: unknown;
}

const RETRYABLE_CODES = new Set(['40001', '40P01', '55P03', '57014', 'P2034']);
const UNIQUE_CODES = new Set(['23505', 'P2002']);
const CONSTRAINT_CODES = new Set([
  '23502',
  '23503',
  '23514',
  '23P01',
  'P2003',
  'P2004',
]);
const UNAVAILABLE_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
]);

function readCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode ?? undefined;
  }
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as ErrorWithCode;
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }

  return readCode(candidate.cause);
}

export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return error;
  }

  const code = readCode(error);
  if (code !== undefined && UNIQUE_CODES.has(code)) {
    return new DatabaseError('unique', false, { cause: error });
  }
  if (code !== undefined && RETRYABLE_CODES.has(code)) {
    return new DatabaseError('retryable', true, { cause: error });
  }
  if (code !== undefined && CONSTRAINT_CODES.has(code)) {
    return new DatabaseError('constraint', false, { cause: error });
  }
  if (
    (code !== undefined && UNAVAILABLE_CODES.has(code)) ||
    error instanceof Prisma.PrismaClientInitializationError
  ) {
    return new DatabaseError('unavailable', true, { cause: error });
  }

  return new DatabaseError('unknown', false, { cause: error });
}
