/**
 * Structured JSON logging for DLQ Monitor
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface LogContext {
  [key: string]: unknown;
}

/**
 * Structured logger that outputs JSON for CloudWatch Logs Insights
 */
export class Logger {
  private serviceName: string;

  constructor(serviceName: string = 'dlq-monitor') {
    this.serviceName = serviceName;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...context,
    };

    console.log(JSON.stringify(logEntry));
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('ERROR', message, context);
  }

  debug(message: string, context?: LogContext): void {
    // Only log debug in non-production environments
    if (process.env['NODE_ENV'] !== 'production') {
      this.log('DEBUG', message, context);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
