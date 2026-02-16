/**
 * Message enrichment logic for DLQ Monitor
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, ListRulesCommand } from '@aws-sdk/client-eventbridge';
import type { Message } from '@aws-sdk/client-sqs';
import {
  AWS_REGION,
  DYNAMODB_TABLES,
  EVENT_BUS_NAME,
  type EnrichedDLQMessage,
  type MessageAttributes,
  type MessageEnrichment,
  type ErrorPattern,
  type DeploymentEvent,
} from '@queuemint/shared';
import { logger } from './logging';
import { getRetryCount } from './deduplication';

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({ region: AWS_REGION });

/**
 * Enrich a message with contextual metadata
 * 
 * @param message - Raw SQS message
 * @param queueUrl - Source queue URL
 * @param queueName - Source queue name
 * @returns Enriched message with metadata
 */
export async function enrichMessage(
  message: Message,
  queueUrl: string,
  queueName: string
): Promise<EnrichedDLQMessage> {
  const messageId = message.MessageId || 'unknown';
  const body = message.Body || '{}';

  logger.debug('Starting message enrichment', { messageId, queueName });

  // Parse attributes
  const attributes = parseMessageAttributes(message);

  // Run enrichment operations in parallel
  const [retryCount, similarFailuresCount, recentDeployments, errorPattern] = await Promise.all([
    getRetryCount(messageId, queueName),
    countSimilarFailures(messageId, queueName),
    getRecentDeployments(),
    extractErrorPattern(body, queueName),
  ]);

  const enrichment: MessageEnrichment = {
    retryCount,
    firstSeenAt: attributes.approximateFirstReceiveTimestamp,
    lastFailedAt: Date.now(),
    similarFailuresLast1h: similarFailuresCount,
    recentDeployments,
    errorPattern,
  };

  logger.info('Message enriched successfully', {
    messageId,
    queueName,
    retryCount,
    similarFailuresCount,
    recentDeploymentsCount: recentDeployments.length,
  });

  return {
    messageId,
    receiptHandle: message.ReceiptHandle || '',
    body,
    attributes,
    sourceQueue: queueName,
    enrichment,
  };
}

/**
 * Parse SQS message attributes
 */
function parseMessageAttributes(message: Message): MessageAttributes {
  const attrs = message.Attributes || {};

  return {
    approximateReceiveCount: parseInt(attrs['ApproximateReceiveCount'] || '1', 10),
    sentTimestamp: parseInt(attrs['SentTimestamp'] || String(Date.now()), 10),
    approximateFirstReceiveTimestamp: parseInt(
      attrs['ApproximateFirstReceiveTimestamp'] || String(Date.now()),
      10
    ),
  };
}

/**
 * Extract error pattern from message body
 */
export async function extractErrorPattern(body: string, queueName: string): Promise<ErrorPattern> {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(body) as Record<string, unknown>;

    // Extract error information - support multiple message formats
    const error = parsed['error'] as Record<string, unknown> | string | undefined;
    const errorMessage =
      (typeof error === 'object' ? (error?.['message'] as string) : undefined) ||
      (parsed['errorMessage'] as string) ||
      (parsed['message'] as string) ||
      (typeof error === 'string' ? error : undefined) ||
      'Unknown error';

    const errorType =
      (typeof error === 'object' ? (error?.['name'] as string) : undefined) ||
      (typeof error === 'object' ? (error?.['type'] as string) : undefined) ||
      (parsed['errorType'] as string) ||
      inferErrorType(errorMessage);

    // Handle stack trace as string or array (AWS Lambda format)
    let stackTraceRaw = 
      (typeof error === 'object' ? (error?.['stack'] as string) : undefined) ||
      (parsed['stackTrace'] as string | string[]) ||
      (parsed['stack'] as string);
    
    if (Array.isArray(stackTraceRaw)) {
      stackTraceRaw = stackTraceRaw.join('\n');
    }
    const stackTrace = truncateStackTrace(stackTraceRaw as string | undefined);

    const errorCode =
      (typeof error === 'object' ? (error?.['code'] as string) : undefined) ||
      (parsed['errorCode'] as string) ||
      (parsed['statusCode'] as string) ||
      extractStatusCode(errorMessage) ||
      (typeof error === 'string' ? extractStatusCode(error) : undefined);

    // Truncate error message to 500 chars
    const truncatedMessage = errorMessage.length > 500
      ? errorMessage.substring(0, 500) + '...'
      : errorMessage;

    return {
      errorType,
      errorMessage: truncatedMessage,
      stackTrace,
      errorCode,
      affectedService: inferServiceFromQueue(queueName),
    };
  } catch {
    // If not JSON or parsing fails, treat entire body as error message
    const truncatedBody = body.length > 500 ? body.substring(0, 500) + '...' : body;

    return {
      errorType: 'ParseError',
      errorMessage: truncatedBody,
      affectedService: inferServiceFromQueue(queueName),
    };
  }
}

/**
 * Infer error type from error message
 */
function inferErrorType(errorMessage: string): string {
  if (/timeout|ETIMEDOUT/i.test(errorMessage)) return 'TimeoutError';
  if (/network|ECONNREFUSED|ENOTFOUND/i.test(errorMessage)) return 'NetworkError';
  if (/validation|invalid|missing/i.test(errorMessage)) return 'ValidationError';
  if (/\d{3}/.test(errorMessage)) return 'HTTPError';
  if (/permission|forbidden|unauthorized/i.test(errorMessage)) return 'PermissionError';
  return 'UnknownError';
}

/**
 * Extract HTTP status code from error message
 */
function extractStatusCode(errorMessage: string): string | undefined {
  const match = errorMessage.match(/\b([45]\d{2})\b/);
  return match?.[1];
}

/**
 * Truncate stack trace to top 3 frames
 */
function truncateStackTrace(stackTrace: string | undefined): string | undefined {
  if (!stackTrace) return undefined;

  const lines = stackTrace.split('\n').slice(0, 4); // Error message + top 3 frames
  return lines.join('\n');
}

/**
 * Infer service name from queue name
 */
function inferServiceFromQueue(queueName: string): string {
  // Remove common suffixes (case-insensitive)
  let cleanName = queueName.replace(/-dlq$/i, '').replace(/_dlq$/i, '');
  
  // Convert kebab-case or snake_case to PascalCase
  return cleanName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Count similar failures in the last hour
 */
async function countSimilarFailures(messageId: string, queueName: string): Promise<number> {
  try {
    const oneHourAgo = Date.now() - 3600000; // 1 hour

    const result = await docClient.send(
      new QueryCommand({
        TableName: DYNAMODB_TABLES.MESSAGE_DEDUPLICATION,
        IndexName: 'queueName-lastSeenAt-index',
        KeyConditionExpression: 'queueName = :queueName AND lastSeenAt > :oneHourAgo',
        ExpressionAttributeValues: {
          ':queueName': queueName,
          ':oneHourAgo': oneHourAgo,
        },
        Select: 'COUNT',
      })
    );

    // Subtract 1 for the current message
    return Math.max(0, (result.Count || 0) - 1);
  } catch (error) {
    logger.warn('Failed to count similar failures', {
      messageId,
      queueName,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Get recent deployments from EventBridge
 * 
 * Note: In a real implementation, this would query a deployment tracking system.
 * For now, we'll return mock data or query EventBridge rules.
 */
async function getRecentDeployments(): Promise<DeploymentEvent[]> {
  try {
    // In MVP, we'll return empty array
    // In Phase 2, this will query EventBridge or a deployment tracking DynamoDB table
    logger.debug('Querying recent deployments', { eventBusName: EVENT_BUS_NAME });

    // Placeholder: In production, query deployment events from EventBridge or DynamoDB
    const fifteenMinutesAgo = Date.now() - 900000;

    // For MVP, return empty array
    // TODO: Implement in Phase 2 (Day 15-16)
    return [];
  } catch (error) {
    logger.warn('Failed to fetch recent deployments', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
