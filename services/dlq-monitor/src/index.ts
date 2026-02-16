/**
 * DLQ Monitor Lambda Handler
 * Polls DLQs, enriches messages, and forwards to Failure Analyzer via EventBridge
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SQSClient,
  ListQueuesCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { AWS_REGION, EVENT_BUS_NAME, type EnrichedDLQMessage } from '@queuemint/shared';
import type { EventBridgeEvent } from 'aws-lambda';

import { checkAndRecordMessage } from './deduplication';
import { enrichMessage } from './enrichment';
import { logger } from './logging';
import type { DLQConfig, QueuedMessage, CloudWatchAlarmEvent } from './types';

const sqsClient = new SQSClient({ region: AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: AWS_REGION });

// Configuration
const DEFAULT_CONFIG: DLQConfig = {
  queueNamePattern: process.env['DLQ_PATTERN'] || '-dlq',
  maxMessages: parseInt(process.env['MAX_MESSAGES'] || '10', 10),
  visibilityTimeout: parseInt(process.env['VISIBILITY_TIMEOUT'] || '300', 10), // 5 minutes
  waitTimeSeconds: parseInt(process.env['WAIT_TIME_SECONDS'] || '10', 10), // Long polling
};

/**
 * Main Lambda handler
 * Triggered by EventBridge Schedule or CloudWatch Alarm
 */
export async function handler(
  event: EventBridgeEvent<string, unknown> | CloudWatchAlarmEvent
): Promise<void> {
  logger.info('DLQ Monitor invoked', { event });

  try {
    // Discover DLQs
    const queueUrls = await discoverDLQs(DEFAULT_CONFIG.queueNamePattern);
    logger.info('Discovered DLQs', { count: queueUrls.length, queues: queueUrls });

    if (queueUrls.length === 0) {
      logger.warn('No DLQs found matching pattern', {
        pattern: DEFAULT_CONFIG.queueNamePattern,
      });
      return;
    }

    // Poll all DLQs in parallel
    const messagesByQueue = await Promise.all(
      queueUrls.map(queueUrl => pollQueue(queueUrl, DEFAULT_CONFIG))
    );

    const allMessages = messagesByQueue.flat();
    logger.info('Polled messages from all DLQs', { totalMessages: allMessages.length });

    if (allMessages.length === 0) {
      logger.info('No messages found in any DLQ');
      return;
    }

    // Process messages: deduplicate, enrich, forward
    const results = await processMessages(allMessages);

    logger.info('DLQ Monitor completed', {
      messagesProcessed: results.processed,
      messagesFailed: results.failed,
      messagesForwarded: results.forwarded,
    });
  } catch (error) {
    logger.error('DLQ Monitor failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Discover all DLQs matching the pattern
 */
async function discoverDLQs(pattern: string): Promise<string[]> {
  try {
    const result = await sqsClient.send(new ListQueuesCommand({}));
    const queueUrls = result.QueueUrls || [];

    // Filter queues matching DLQ pattern
    return queueUrls.filter(url => url.includes(pattern));
  } catch (error) {
    logger.error('Failed to discover DLQs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Poll messages from a single queue
 */
async function pollQueue(queueUrl: string, config: DLQConfig): Promise<QueuedMessage[]> {
  const queueName = extractQueueName(queueUrl);

  try {
    logger.debug('Polling queue', { queueName, queueUrl });

    const result = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: config.maxMessages,
        VisibilityTimeout: config.visibilityTimeout,
        WaitTimeSeconds: config.waitTimeSeconds,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
      })
    );

    const messages = result.Messages || [];
    logger.info('Received messages from queue', {
      queueName,
      count: messages.length,
    });

    return messages.map(message => ({
      message,
      queueUrl,
      queueName,
    }));
  } catch (error) {
    logger.error('Failed to poll queue', {
      queueName,
      queueUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Process messages: deduplicate, enrich, and forward
 */
async function processMessages(
  messages: QueuedMessage[]
): Promise<{ processed: number; failed: number; forwarded: number }> {
  let processed = 0;
  let failed = 0;
  let forwarded = 0;

  for (const { message, queueUrl, queueName } of messages) {
    try {
      const messageId = message.MessageId || 'unknown';

      // Step 1: Deduplicate
      const dedupResult = await checkAndRecordMessage(messageId, queueName);

      // Skip if this is a duplicate we've already processed
      if (dedupResult.isDuplicate && dedupResult.retryCount > 3) {
        logger.warn('Message exceeded retry limit, skipping', {
          messageId,
          queueName,
          retryCount: dedupResult.retryCount,
        });
        
        // Delete message from DLQ to prevent infinite loop
        await deleteMessage(queueUrl, message.ReceiptHandle || '');
        processed++;
        continue;
      }

      // Step 2: Enrich message
      const enrichedMessage = await enrichMessage(message, queueUrl, queueName);

      // Step 3: Forward to EventBridge
      await forwardToEventBridge(enrichedMessage);
      forwarded++;

      // Step 4: Delete message from DLQ (successful processing)
      await deleteMessage(queueUrl, message.ReceiptHandle || '');
      processed++;

      logger.info('Message processed successfully', {
        messageId,
        queueName,
        retryCount: dedupResult.retryCount,
      });
    } catch (error) {
      failed++;
      logger.error('Failed to process message', {
        messageId: message.MessageId,
        queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't delete message on error - let it remain in DLQ for retry
    }
  }

  return { processed, failed, forwarded };
}

/**
 * Forward enriched message to EventBridge for classification
 */
async function forwardToEventBridge(enrichedMessage: EnrichedDLQMessage): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'queuemint.dlq-monitor',
            DetailType: 'DLQ Message Enriched',
            Detail: JSON.stringify(enrichedMessage),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      })
    );

    logger.debug('Forwarded message to EventBridge', {
      messageId: enrichedMessage.messageId,
      sourceQueue: enrichedMessage.sourceQueue,
    });
  } catch (error) {
    logger.error('Failed to forward to EventBridge', {
      messageId: enrichedMessage.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete message from queue after successful processing
 */
async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  try {
    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );

    logger.debug('Deleted message from queue', { queueUrl });
  } catch (error) {
    logger.warn('Failed to delete message from queue', {
      queueUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-fatal: message will be reprocessed after visibility timeout
  }
}

/**
 * Extract queue name from queue URL
 */
function extractQueueName(queueUrl: string): string {
  const parts = queueUrl.split('/');
  return parts[parts.length - 1] || 'unknown';
}
