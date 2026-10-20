import { BaseError } from "./baseError.js";

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
