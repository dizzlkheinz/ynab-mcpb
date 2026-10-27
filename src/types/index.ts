// The same classes production code throws and checks with instanceof

// Re-export error handling types for convenience
export {
	ValidationError,
	withToolErrorHandling,
	YNABErrorCode,
} from "../server/errorHandler.js";
export { AuthenticationError, ConfigurationError } from "../utils/errors.js";
