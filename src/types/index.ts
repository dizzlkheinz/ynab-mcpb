export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthenticationError";
	}
}

export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationError";
	}
}

// Re-export error handling types for convenience
export {
	ValidationError,
	withToolErrorHandling,
	YNABErrorCode,
} from "../server/errorHandler.js";
