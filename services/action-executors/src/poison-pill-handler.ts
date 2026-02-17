/**
 * Poison pill handler
 * Archives bad messages to S3 and sends SNS alert
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

import {
  POISON_PILL_BUCKET,
  SNS_ALERT_TOPIC_ARN,
  S3_POISON_PILL_PREFIX,
  AWS_REGION,
} from './constants';
import type { ActionContext, ActionResult } from './types';

// Singleton clients
let s3Client: S3Client;
let snsClient: SNSClient;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: AWS_REGION });
  }
  return s3Client;
}

function getSNSClient(): SNSClient {
  if (!snsClient) {
    snsClient = new SNSClient({ region: AWS_REGION });
  }
  return snsClient;
}

/**
 * Generate S3 key for poison pill message
 * Format: poison-pills/{date}/{queue}/{messageId}.json
 */
export function generateS3Key(messageId: string, sourceQueue: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${S3_POISON_PILL_PREFIX}/${date}/${sourceQueue}/${messageId}.json`;
}

/**
 * Handle poison pill - archive to S3 and alert
 */
export async function handlePoisonPill(
  context: ActionContext
): Promise<ActionResult> {
  const { message, classification } = context;
  const startTime = Date.now();
  
  try {
    const s3Key = generateS3Key(message.messageId, message.sourceQueue);
    
    console.log('Archiving poison pill message', {
      messageId: message.messageId,
      sourceQueue: message.sourceQueue,
      s3Key,
    });
    
    // Archive message to S3
    const archiveData = {
      message,
      classification,
      archivedAt: new Date().toISOString(),
      reason: classification.reasoning,
    };
    
    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: POISON_PILL_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(archiveData, null, 2),
        ContentType: 'application/json',
        Metadata: {
          'message-id': message.messageId,
          'source-queue': message.sourceQueue,
          'classification-category': classification.category,
          'confidence': String(classification.confidence),
        },
      })
    );
    
    console.log('Message archived to S3', {
      messageId: message.messageId,
      bucket: POISON_PILL_BUCKET,
      key: s3Key,
    });
    
    // Send SNS alert
    const alertMessage = {
      messageId: message.messageId,
      sourceQueue: message.sourceQueue,
      category: classification.category,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      s3Location: `s3://${POISON_PILL_BUCKET}/${s3Key}`,
      archivedAt: new Date().toISOString(),
      errorSummary: {
        errorType: message.enrichment.errorPattern.errorType,
        errorMessage: message.enrichment.errorPattern.errorMessage.substring(0, 200),
      },
    };
    
    const sns = getSNSClient();
    await sns.send(
      new PublishCommand({
        TopicArn: SNS_ALERT_TOPIC_ARN,
        Subject: `[QueueMint] Poison Pill Detected: ${message.sourceQueue}`,
        Message: JSON.stringify(alertMessage, null, 2),
        MessageAttributes: {
          'message_id': {
            DataType: 'String',
            StringValue: message.messageId,
          },
          'source_queue': {
            DataType: 'String',
            StringValue: message.sourceQueue,
          },
          'alert_type': {
            DataType: 'String',
            StringValue: 'POISON_PILL',
          },
        },
      })
    );
    
    console.log('Alert sent successfully', {
      messageId: message.messageId,
      topicArn: SNS_ALERT_TOPIC_ARN,
      latencyMs: Date.now() - startTime,
    });
    
    return {
      success: true,
      action: 'ARCHIVE',
      messageId: message.messageId,
      details: {
        s3Key,
      },
    };
  } catch (error) {
    console.error('Failed to archive poison pill', {
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    });
    
    return {
      success: false,
      action: 'ARCHIVE',
      messageId: message.messageId,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
