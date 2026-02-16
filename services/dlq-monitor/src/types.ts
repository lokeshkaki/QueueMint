/**
 * Types specific to DLQ Monitor Lambda
 */

import type { Message } from '@aws-sdk/client-sqs';

/**
 * Configuration for DLQ discovery and polling
 */
export interface DLQConfig {
  /** Pattern to match DLQ names */
  queueNamePattern: string;
  /** Maximum messages to receive per batch */
  maxMessages: number;
  /** Visibility timeout in seconds */
  visibilityTimeout: number;
  /** Wait time for long polling in seconds */
  waitTimeSeconds: number;
}

/**
 * SQS Message with queue context
 */
export interface QueuedMessage {
  message: Message;
  queueUrl: string;
  queueName: string;
}

/**
 * Result of message deduplication check
 */
export interface DeduplicationResult {
  /** Whether this message is a duplicate */
  isDuplicate: boolean;
  /** When message was first seen (if duplicate) */
  firstSeenAt?: number;
  /** Current retry count */
  retryCount: number;
}

/**
 * Result of enrichment process
 */
export interface EnrichmentResult {
  /** Number of messages successfully enriched */
  enrichedCount: number;
  /** Number of messages that failed enrichment */
  failedCount: number;
  /** Errors encountered during enrichment */
  errors: EnrichmentError[];
}

export interface EnrichmentError {
  messageId: string;
  error: string;
  queueName: string;
}

/**
 * CloudWatch alarm event structure
 */
export interface CloudWatchAlarmEvent {
  detail: {
    alarmName: string;
    state: {
      value: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
      reason: string;
    };
  };
}
