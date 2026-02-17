/**
 * Unit tests for transient handler
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { EnrichedDLQMessage } from '@queuemint/shared';
import { mockClient } from 'aws-sdk-client-mock';

import { handleTransientFailure, calculateBackoffDelay } from '../src/transient-handler';
import type { ActionContext } from '../src/types';


// Mock SQS client
const sqsMock = mockClient(SQSClient);

describe('transient-handler', () => {
  const mockMessage: EnrichedDLQMessage = {
    messageId: 'msg-123',
    receiptHandle: 'handle-123',
    body: JSON.stringify({ data: 'test' }),
    attributes: {
      approximateReceiveCount: 1,
      sentTimestamp: Date.now(),
      approximateFirstReceiveTimestamp: Date.now(),
    },
    sourceQueue: 'webhook-dlq',
    enrichment: {
      retryCount: 1,
      firstSeenAt: Date.now(),
      lastFailedAt: Date.now(),
      similarFailuresLast1h: 2,
      recentDeployments: [],
      errorPattern: {
        errorType: 'NetworkError',
        errorMessage: 'ETIMEDOUT: connection timeout',
        stackTrace: 'at handler (index.js:10)',
        errorCode: 'ETIMEDOUT',
        affectedService: 'webhook-service',
      },
    },
  };

  const mockClassification = {
    category: 'TRANSIENT' as const,
    confidence: 0.95,
    reasoning: 'Network timeout - transient failure',
    recommendedAction: {
      action: 'REPLAY' as const,
      retryDelaySeconds: 60,
      humanReviewRequired: false,
    },
    metadata: {
      llmModel: 'heuristic',
      tokens: { input: 0, output: 0 },
      latencyMs: 5,
      cacheHit: false,
    },
  };

  beforeEach(() => {
    sqsMock.reset();
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      expect(calculateBackoffDelay(0)).toBe(30); // 30 * 2^0 = 30
      expect(calculateBackoffDelay(1)).toBe(60); // 30 * 2^1 = 60
      expect(calculateBackoffDelay(2)).toBe(120); // 30 * 2^2 = 120
      expect(calculateBackoffDelay(3)).toBe(240); // 30 * 2^3 = 240
      expect(calculateBackoffDelay(4)).toBe(480); // 30 * 2^4 = 480
    });

    it('should cap backoff at MAX_BACKOFF_SECONDS (900)', () => {
      expect(calculateBackoffDelay(10)).toBe(900); // Would be 30720, capped at 900
      expect(calculateBackoffDelay(100)).toBe(900);
    });
  });

  describe('handleTransientFailure', () => {
    it('should successfully replay message with delay', async () => {
      sqsMock.on(SendMessageCommand).resolves({});

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handleTransientFailure(context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('REPLAY');
      expect(result.messageId).toBe('msg-123');
      expect(result.details?.replayDelaySeconds).toBe(60);
      
      // Verify SQS message was sent
      expect(sqsMock.calls()).toHaveLength(1);
      const call = sqsMock.call(0);
      expect(call.args[0].input).toMatchObject({
        MessageBody: mockMessage.body,
        DelaySeconds: 60,
      });
    });

    it('should use calculated backoff if no recommended delay', async () => {
      sqsMock.on(SendMessageCommand).resolves({});

      const contextNoDelay: ActionContext = {
        message: mockMessage,
        classification: {
          ...mockClassification,
          recommendedAction: {
            action: 'REPLAY',
            humanReviewRequired: false,
          },
        },
      };

      const result = await handleTransientFailure(contextNoDelay);

      expect(result.success).toBe(true);
      expect(result.details?.replayDelaySeconds).toBe(60); // 30 * 2^1
    });

    it('should fail if max retries exceeded', async () => {
      const contextMaxRetries: ActionContext = {
        message: {
          ...mockMessage,
          enrichment: {
            ...mockMessage.enrichment,
            retryCount: 5, // MAX_RETRY_ATTEMPTS = 5
          },
        },
        classification: mockClassification,
      };

      const result = await handleTransientFailure(contextMaxRetries);

      expect(result.success).toBe(false);
      expect(result.action).toBe('REPLAY');
      expect(result.details?.error).toContain('Max retry attempts');
      expect(sqsMock.calls()).toHaveLength(0); // No SQS call made
    });

    it('should include retry metadata in message attributes', async () => {
      sqsMock.on(SendMessageCommand).resolves({});

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handleTransientFailure(context);

      const call = sqsMock.call(0);
      expect(call.args[0].input.MessageAttributes).toMatchObject({
        'queuemint.retryCount': {
          DataType: 'Number',
          StringValue: '2', // retryCount + 1
        },
        'queuemint.originalMessageId': {
          DataType: 'String',
          StringValue: 'msg-123',
        },
        'queuemint.classificationCategory': {
          DataType: 'String',
          StringValue: 'TRANSIENT',
        },
      });
    });

    it('should handle SQS errors gracefully', async () => {
      sqsMock.on(SendMessageCommand).rejects(new Error('SQS unavailable'));

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handleTransientFailure(context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('REPLAY');
      expect(result.details?.error).toBe('SQS unavailable');
    });

    it('should cap delay at 900 seconds (SQS max)', async () => {
      sqsMock.on(SendMessageCommand).resolves({});

      const contextLongDelay: ActionContext = {
        message: mockMessage,
        classification: {
          ...mockClassification,
          recommendedAction: {
            action: 'REPLAY',
            retryDelaySeconds: 1800, // 30 minutes
            humanReviewRequired: false,
          },
        },
      };

      await handleTransientFailure(contextLongDelay);

      const call = sqsMock.call(0);
      expect(call.args[0].input.DelaySeconds).toBe(900); // Capped at 15 minutes
    });
  });
});
