export { ValidationError } from "./validationError.js";

import { BaseError } from "./baseError.js";

export class ConfigurationError extends BaseError {}

export class AuthenticationError extends BaseError {}
