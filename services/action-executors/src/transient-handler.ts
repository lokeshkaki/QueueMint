/**
 * Transient failure handler
 * Retries message to original queue with exponential backoff
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import {
  ORIGINAL_QUEUE_URL,
  MIN_BACKOFF_SECONDS,
  MAX_BACKOFF_SECONDS,
  BACKOFF_MULTIPLIER,
  MAX_RETRY_ATTEMPTS,
  AWS_REGION,
} from './constants';
import type { ActionContext, ActionResult } from './types';

// Singleton SQS client
let sqsClient: SQSClient;

function getSQSClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region: AWS_REGION });
  }
  return sqsClient;
}

/**
 * Calculate exponential backoff delay
 * Formula: min(MAX_BACKOFF, MIN_BACKOFF * 2^retryCount)
 */
export function calculateBackoffDelay(retryCount: number): number {
  const delay = MIN_BACKOFF_SECONDS * Math.pow(BACKOFF_MULTIPLIER, retryCount);
  return Math.min(delay, MAX_BACKOFF_SECONDS);
}

/**
 * Handle transient failure - retry with exponential backoff
 */
export async function handleTransientFailure(
  context: ActionContext
): Promise<ActionResult> {
  const { message, classification } = context;
  const startTime = Date.now();
  
  try {
    // Check if message has exceeded max retries
    const retryCount = message.enrichment.retryCount;
    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      console.error('Max retry attempts exceeded', {
        messageId: message.messageId,
        retryCount,
        maxRetries: MAX_RETRY_ATTEMPTS,
      });
      
      return {
        success: false,
        action: 'REPLAY',
        messageId: message.messageId,
        details: {
          error: `Max retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded`,
        },
      };
    }
    
    // Calculate delay based on retry count or recommended action
    const delaySeconds = classification.recommendedAction.retryDelaySeconds
      || calculateBackoffDelay(retryCount);
    
    console.log('Retrying transient failure', {
      messageId: message.messageId,
      retryCount,
      delaySeconds,
      targetQueue: message.sourceQueue,
    });
    
    // Send message to original queue with delay
    const client = getSQSClient();
    await client.send(
      new SendMessageCommand({
        QueueUrl: ORIGINAL_QUEUE_URL,
        MessageBody: message.body,
        DelaySeconds: Math.min(delaySeconds, 900), // SQS max delay is 15 minutes
        MessageAttributes: {
          'queuemint.retryCount': {
            DataType: 'Number',
            StringValue: String(retryCount + 1),
          },
          'queuemint.originalMessageId': {
            DataType: 'String',
            StringValue: message.messageId,
          },
          'queuemint.classificationCategory': {
            DataType: 'String',
            StringValue: classification.category,
          },
        },
      })
    );
    
    console.log('Message replayed successfully', {
      messageId: message.messageId,
      newRetryCount: retryCount + 1,
      latencyMs: Date.now() - startTime,
    });
    
    return {
      success: true,
      action: 'REPLAY',
      messageId: message.messageId,
      details: {
        replayDelaySeconds: delaySeconds,
        targetQueue: ORIGINAL_QUEUE_URL,
      },
    };
  } catch (error) {
    console.error('Failed to replay message', {
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    });
    
    return {
      success: false,
      action: 'REPLAY',
      messageId: message.messageId,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
