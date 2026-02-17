/**
 * Constants for action executors
 */

// Environment variables
export const ORIGINAL_QUEUE_URL = process.env['ORIGINAL_QUEUE_URL'] || '';
export const POISON_PILL_BUCKET = process.env['POISON_PILL_BUCKET'] || '';
export const SNS_ALERT_TOPIC_ARN = process.env['SNS_ALERT_TOPIC_ARN'] || '';
export const PAGERDUTY_INTEGRATION_KEY = process.env['PAGERDUTY_INTEGRATION_KEY'] || '';
export const AWS_REGION = process.env['AWS_REGION'] || 'us-east-1';

// Exponential backoff configuration
export const MIN_BACKOFF_SECONDS = 30;
export const MAX_BACKOFF_SECONDS = 900; // 15 minutes
export const BACKOFF_MULTIPLIER = 2;
export const MAX_RETRY_ATTEMPTS = 5;

// PagerDuty severities
export const PAGERDUTY_SEVERITIES = {
  P1: 'critical',
  P2: 'error',
  P3: 'warning',
} as const;

// S3 key prefix for poison pill messages
export const S3_POISON_PILL_PREFIX = 'poison-pills';
