/**
 * Unit tests for structured logging
 */

import { Logger, logger } from '../src/logging';

describe('Structured Logging', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Logger', () => {
    it('should log INFO messages with structured JSON', () => {
      const testLogger = new Logger('test-service');

      testLogger.info('Test message', { key: 'value', count: 42 });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData).toMatchObject({
        level: 'INFO',
        service: 'test-service',
        message: 'Test message',
        key: 'value',
        count: 42,
      });

      expect(loggedData.timestamp).toBeDefined();
      expect(new Date(loggedData.timestamp as string).getTime()).toBeGreaterThan(0);
    });

    it('should log WARN messages', () => {
      logger.warn('Warning test', { warning: true });

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData).toMatchObject({
        level: 'WARN',
        message: 'Warning test',
        warning: true,
      });
    });

    it('should log ERROR messages', () => {
      logger.error('Error test', { error: 'Something failed', code: 500 });

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData).toMatchObject({
        level: 'ERROR',
        message: 'Error test',
        error: 'Something failed',
        code: 500,
      });
    });

    it('should log DEBUG messages in non-production', () => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      logger.debug('Debug test', { debug: true });

      expect(consoleLogSpy).toHaveBeenCalled();

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(loggedData.level).toBe('DEBUG');

      process.env['NODE_ENV'] = originalEnv;
    });

    it('should not log DEBUG messages in production', () => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      logger.debug('Debug test', { debug: true });

      expect(consoleLogSpy).not.toHaveBeenCalled();

      process.env['NODE_ENV'] = originalEnv;
    });

    it('should handle messages without context', () => {
      logger.info('Simple message');

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData).toMatchObject({
        level: 'INFO',
        message: 'Simple message',
      });
    });

    it('should include service name in logs', () => {
      const customLogger = new Logger('custom-service');

      customLogger.info('Test');

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData.service).toBe('custom-service');
    });

    it('should use default service name', () => {
      logger.info('Test');

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData.service).toBe('dlq-monitor');
    });

    it('should handle complex objects in context', () => {
      const complexObject = {
        nested: {
          array: [1, 2, 3],
          boolean: true,
          null: null,
        },
        string: 'test',
      };

      logger.info('Complex context', complexObject);

      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(loggedData.nested).toEqual({
        array: [1, 2, 3],
        boolean: true,
        null: null,
      });
      expect(loggedData.string).toBe('test');
    });

    it('should output valid JSON for CloudWatch Logs Insights', () => {
      logger.info('CloudWatch test', {
        messageId: 'msg-123',
        queueName: 'test-dlq',
        retryCount: 2,
      });

      const output = consoleLogSpy.mock.calls[0][0] as string;

      // Should be valid JSON
      expect(() => JSON.parse(output)).not.toThrow();

      // Should be single line (no newlines in output)
      expect(output.split('\n')).toHaveLength(1);
    });
  });
});
