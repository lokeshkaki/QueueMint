/**
 * DynamoDB-based message deduplication
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AWS_REGION, DYNAMODB_TABLES } from '@queuemint/shared';

import { logger } from './logging';
import type { DeduplicationResult } from './types';

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Check if message has been seen before and update retry count
 * 
 * @param messageId - SQS message ID
 * @param queueName - Source queue name
 * @returns Deduplication result with retry count
 */
export async function checkAndRecordMessage(
  messageId: string,
  queueName: string
): Promise<DeduplicationResult> {
  const tableName = DYNAMODB_TABLES.MESSAGE_DEDUPLICATION;
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + 86400 * 7; // 7 days TTL

  try {
    // First, check if message exists
    const getResult = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          messageId,
          queueName,
        },
      })
    );

    if (getResult.Item) {
      // Message seen before - this is a duplicate
      const retryCount = (getResult.Item['retryCount'] as number) + 1;

      // Update retry count
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            messageId,
            queueName,
            firstSeenAt: getResult.Item['firstSeenAt'],
            lastSeenAt: now,
            retryCount,
            ttl,
          },
        })
      );

      logger.info('Message is duplicate', {
        messageId,
        queueName,
        retryCount,
        firstSeenAt: getResult.Item['firstSeenAt'],
      });

      return {
        isDuplicate: true,
        firstSeenAt: getResult.Item['firstSeenAt'] as number,
        retryCount,
      };
    }

    // First time seeing this message
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          messageId,
          queueName,
          firstSeenAt: now,
          lastSeenAt: now,
          retryCount: 0,
          ttl,
        },
      })
    );

    logger.info('Message recorded as new', { messageId, queueName });

    return {
      isDuplicate: false,
      retryCount: 0,
    };
  } catch (error) {
    logger.error('Failed to check/record message', {
      messageId,
      queueName,
      error: error instanceof Error ? error.message : String(error),
    });

    // On error, assume not a duplicate to avoid message loss
    return {
      isDuplicate: false,
      retryCount: 0,
    };
  }
}

/**
 * Get retry count for a message
 * 
 * @param messageId - SQS message ID
 * @param queueName - Source queue name
 * @returns Retry count (0 if not found)
 */
export async function getRetryCount(messageId: string, queueName: string): Promise<number> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: DYNAMODB_TABLES.MESSAGE_DEDUPLICATION,
        Key: {
          messageId,
          queueName,
        },
      })
    );

    return (result.Item?.['retryCount'] as number) || 0;
  } catch (error) {
    logger.error('Failed to get retry count', {
      messageId,
      queueName,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
