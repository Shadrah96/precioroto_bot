import type { FetchFailure } from '../types.ts';

export class FetchError extends Error {
  reason: FetchFailure;
  constructor(reason: FetchFailure, message: string) {
    super(message);
    this.name = 'FetchError';
    this.reason = reason;
  }
}
