import { randomBytes, randomInt } from 'node:crypto';

export abstract class IdentityRandomSource {
  abstract index(upperBound: number): number;
  abstract numericSuffix(length: number): string;
  abstract fallbackSuffix(): string;
}

export class CryptoIdentityRandomSource extends IdentityRandomSource {
  index(upperBound: number): number {
    return randomInt(upperBound);
  }

  numericSuffix(length: number): string {
    let result = '';
    for (let position = 0; position < length; position += 1) {
      result += String(randomInt(10));
    }
    return result;
  }

  fallbackSuffix(): string {
    return randomBytes(6).toString('hex');
  }
}
