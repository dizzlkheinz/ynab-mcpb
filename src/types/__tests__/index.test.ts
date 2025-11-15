import { describe, it, expect } from 'vitest';
import { AuthenticationError, ConfigurationError } from '../index';

describe('Error Classes', () => {
  describe('AuthenticationError', () => {
    it('should create error with correct name and message', () => {
      const message = 'Invalid access token';
      const error = new AuthenticationError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.name).toBe('AuthenticationError');
      expect(error.message).toBe(message);
    });

    it('should be throwable and catchable', () => {
      const message = 'Token expired';

      expect(() => {
        throw new AuthenticationError(message);
      }).toThrow(AuthenticationError);

      expect(() => {
        throw new AuthenticationError(message);
      }).toThrow(message);
    });
  });

  describe('ConfigurationError', () => {
    it('should create error with correct name and message', () => {
      const message = 'Missing environment variable';
      const error = new ConfigurationError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.name).toBe('ConfigurationError');
      expect(error.message).toBe(message);
    });

    it('should be throwable and catchable', () => {
      const message = 'Invalid configuration';

      expect(() => {
        throw new ConfigurationError(message);
      }).toThrow(ConfigurationError);

      expect(() => {
        throw new ConfigurationError(message);
      }).toThrow(message);
    });
  });
});
