/**
 * Unit tests for poison pill handler
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { EnrichedDLQMessage } from '@queuemint/shared';
import { mockClient } from 'aws-sdk-client-mock';

import { handlePoisonPill, generateS3Key } from '../src/poison-pill-handler';
import type { ActionContext } from '../src/types';


// Mock AWS SDK clients
const s3Mock = mockClient(S3Client);
const snsMock = mockClient(SNSClient);

describe('poison-pill-handler', () => {
  const mockMessage: EnrichedDLQMessage = {
    messageId: 'msg-456',
    receiptHandle: 'handle-456',
    body: JSON.stringify({ invalid: 'data' }),
    attributes: {
      approximateReceiveCount: 3,
      sentTimestamp: Date.now(),
      approximateFirstReceiveTimestamp: Date.now(),
    },
    sourceQueue: 'payment-dlq',
    enrichment: {
      retryCount: 2,
      firstSeenAt: Date.now(),
      lastFailedAt: Date.now(),
      similarFailuresLast1h: 5,
      recentDeployments: [],
      errorPattern: {
        errorType: 'TypeError',
        errorMessage: 'Cannot read property "amount" of null',
        stackTrace: 'at processPayment (payment.js:45)',
        errorCode: 'ERR_NULL_REFERENCE',
        affectedService: 'payment-service',
      },
    },
  };

  const mockClassification = {
    category: 'POISON_PILL' as const,
    confidence: 0.89,
    reasoning: 'Null pointer exception - bad message data',
    recommendedAction: {
      action: 'ARCHIVE' as const,
      humanReviewRequired: true,
    },
    metadata: {
      llmModel: 'heuristic',
      tokens: { input: 0, output: 0 },
      latencyMs: 3,
      cacheHit: false,
    },
  };

  beforeEach(() => {
    s3Mock.reset();
    snsMock.reset();
  });

  describe('generateS3Key', () => {
    it('should generate correct S3 key format', () => {
      const key = generateS3Key('msg-123', 'webhook-dlq');
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const parts = key.split('/');
      
      expect(parts[0]).toBe('poison-pills');
      expect(parts[1]).toMatch(datePattern); // YYYY-MM-DD
      expect(parts[2]).toBe('webhook-dlq');
      expect(parts[3]).toBe('msg-123.json');
    });

    it('should use current date in key', () => {
      const today = new Date().toISOString().split('T')[0];
      const key = generateS3Key('msg-123', 'test-dlq');
      
      expect(key).toContain(today);
    });
  });

  describe('handlePoisonPill', () => {
    it('should archive message to S3 and send SNS alert', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handlePoisonPill(context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('ARCHIVE');
      expect(result.messageId).toBe('msg-456');
      expect(result.details?.s3Key).toContain('poison-pills');
      expect(result.details?.s3Key).toContain('payment-dlq');
      expect(result.details?.s3Key).toContain('msg-456.json');
      
      // Verify S3 upload was called
      expect(s3Mock.calls()).toHaveLength(1);
      
      // Verify SNS publish was called
      expect(snsMock.calls()).toHaveLength(1);
    });

    it('should upload complete archive data to S3', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handlePoisonPill(context);

      const s3Call = s3Mock.call(0);
      const s3Input = s3Call.args[0].input as any;
      const uploadedBody = JSON.parse(s3Input.Body as string);
      
      expect(uploadedBody).toHaveProperty('message');
      expect(uploadedBody).toHaveProperty('classification');
      expect(uploadedBody).toHaveProperty('archivedAt');
      expect(uploadedBody).toHaveProperty('reason');
      expect(uploadedBody.message.messageId).toBe('msg-456');
      expect(uploadedBody.classification.category).toBe('POISON_PILL');
    });

    it('should include metadata in S3 object', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handlePoisonPill(context);

      const s3Call = s3Mock.call(0);
      const s3Input = s3Call.args[0].input as any;
      expect(s3Input.ContentType).toBe('application/json');
      expect(s3Input.Metadata).toMatchObject({
        'message-id': 'msg-456',
        'source-queue': 'payment-dlq',
        'classification-category': 'POISON_PILL',
        'confidence': '0.89',
      });
    });

    it('should send SNS alert with correct structure', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handlePoisonPill(context);

      const snsCall = snsMock.call(0);
      const snsInput = snsCall.args[0].input as any;
      expect(snsInput.Subject).toContain('Poison Pill Detected');
      expect(snsInput.Subject).toContain('payment-dlq');
      
      const messageBody = JSON.parse(snsInput.Message as string);
      expect(messageBody).toHaveProperty('messageId', 'msg-456');
      expect(messageBody).toHaveProperty('sourceQueue', 'payment-dlq');
      expect(messageBody).toHaveProperty('category', 'POISON_PILL');
      expect(messageBody).toHaveProperty('s3Location');
      expect(messageBody.s3Location).toContain('s3://');
    });

    it('should include message attributes in SNS alert', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handlePoisonPill(context);

      const snsCall = snsMock.call(0);
      const snsInput = snsCall.args[0].input as any;
      expect(snsInput.MessageAttributes).toMatchObject({
        'message_id': {
          DataType: 'String',
          StringValue: 'msg-456',
        },
        'source_queue': {
          DataType: 'String',
          StringValue: 'payment-dlq',
        },
        'alert_type': {
          DataType: 'String',
          StringValue: 'POISON_PILL',
        },
      });
    });

    it('should truncate long error messages in SNS alert', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const longErrorMessage = 'A'.repeat(300);
      const contextLongError: ActionContext = {
        message: {
          ...mockMessage,
          enrichment: {
            ...mockMessage.enrichment,
            errorPattern: {
              ...mockMessage.enrichment.errorPattern,
              errorMessage: longErrorMessage,
            },
          },
        },
        classification: mockClassification,
      };

      await handlePoisonPill(contextLongError);

      const snsCall = snsMock.call(0);
      const snsInput = snsCall.args[0].input as any;
      const messageBody = JSON.parse(snsInput.Message as string);
      
      expect(messageBody.errorSummary.errorMessage).toHaveLength(200); // Truncated
    });

    it('should handle S3 upload errors', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('S3 bucket not accessible'));
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-123' });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handlePoisonPill(context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('ARCHIVE');
      expect(result.details?.error).toBe('S3 bucket not accessible');
      expect(snsMock.calls()).toHaveLength(0); // SNS not called due to early failure
    });

    it('should handle SNS publish errors after successful S3 upload', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      snsMock.on(PublishCommand).rejects(new Error('SNS topic access denied'));

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handlePoisonPill(context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('ARCHIVE');
      expect(result.details?.error).toBe('SNS topic access denied');
      expect(s3Mock.calls()).toHaveLength(1); // S3 was attempted
    });
  });
});
