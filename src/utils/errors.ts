export { BaseError } from './baseError.js';
export { ValidationError } from './validationError.js';
import { BaseError } from './baseError.js';

export class ConfigurationError extends BaseError {}

export class AuthenticationError extends BaseError {}

export class YNABRequestError extends BaseError {
  constructor(
    public status: number,
    public statusText: string,
    public ynabErrorId?: string,
  ) {
    super(
      `YNAB API request failed: ${status} ${statusText}${
        ynabErrorId ? ` (Error ID: ${ynabErrorId})` : ''
      }`,
    );
  }
}
