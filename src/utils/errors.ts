class BaseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = this.constructor.name;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class ValidationError extends BaseError {
	public readonly details?: string | undefined;
	public readonly suggestions?: string[] | undefined;

	constructor(
		message: string,
		details?: string | undefined,
		suggestions?: string[] | undefined,
	) {
		super(message);
		this.details = details;
		this.suggestions = suggestions;
	}
}

export class ConfigurationError extends BaseError {}

export class AuthenticationError extends BaseError {}
