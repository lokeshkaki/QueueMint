/**
 * Unit tests for failure analyzer handler
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { EnrichedDLQMessage } from '@queuemint/shared';
import type { EventBridgeEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';

import { handler } from '../src/index';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Mock classification module
jest.mock('../src/classification', () => ({
  createClassifier: jest.fn(() => ({
    classify: mockClassify,
  })),
}));

const mockClassify = jest.fn();

describe('Failure Analyzer Handler', () => {
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
      retryCount: 0,
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

  const mockEvent: EventBridgeEvent<'DLQMessageEnriched', EnrichedDLQMessage> = {
    version: '0',
    id: 'event-123',
    'detail-type': 'DLQMessageEnriched',
    source: 'queuemint.dlq-monitor',
    account: '123456789012',
    time: new Date().toISOString(),
    region: 'us-east-1',
    resources: [],
    detail: mockMessage,
  };

  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    jest.clearAllMocks();
    
    // Set environment variables
    process.env.FAILURE_ANALYSIS_TABLE = 'test-failure-analysis-table';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
  });

  describe('handler', () => {
    it('should successfully process transient failure', async () => {
      const mockClassificationResult = {
        category: 'TRANSIENT' as const,
        confidence: 0.95,
        reasoning: 'Network timeout - temporary issue',
        recommendedAction: {
          action: 'REPLAY' as const,
          retryDelaySeconds: 30,
          maxRetries: 3,
          humanReviewRequired: false,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 50,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(mockEvent);
      
      // Verify classification called
      expect(mockClassify).toHaveBeenCalledWith(mockMessage);
      
      // Verify DynamoDB put
      expect(ddbMock.commandCalls(PutCommand).length).toBe(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item).toMatchObject({
        messageId: 'msg-123',
        classification: 'TRANSIENT',
        confidence: 0.95,
        actionTaken: 'REPLAYED',
        recoveryOutcome: 'PENDING',
      });
      
      // Verify EventBridge put
      expect(ebMock.commandCalls(PutEventsCommand).length).toBe(1);
      const ebCall = ebMock.commandCalls(PutEventsCommand)[0];
      expect(ebCall.args[0].input.Entries).toHaveLength(1);
      expect(ebCall.args[0].input.Entries![0]).toMatchObject({
        Source: 'queuemint.failure-analyzer',
        DetailType: 'TransientFailure',
      });
    });

    it('should successfully process poison pill failure', async () => {
      const mockClassificationResult = {
        category: 'POISON_PILL' as const,
        confidence: 0.91,
        reasoning: 'Null pointer - corrupt data',
        recommendedAction: {
          action: 'ARCHIVE' as const,
          humanReviewRequired: true,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 45,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(mockEvent);
      
      // Verify DynamoDB put
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item).toMatchObject({
        classification: 'POISON_PILL',
        actionTaken: 'ARCHIVED',
      });
      
      // Verify EventBridge routing
      const ebCall = ebMock.commandCalls(PutEventsCommand)[0];
      expect(ebCall.args[0].input.Entries![0]).toMatchObject({
        DetailType: 'PoisonPillFailure',
      });
    });

    it('should successfully process systemic failure', async () => {
      const mockClassificationResult = {
        category: 'SYSTEMIC' as const,
        confidence: 0.92,
        reasoning: 'Spike in failures after deployment',
        recommendedAction: {
          action: 'ESCALATE' as const,
          escalationSeverity: 'P1' as const,
          humanReviewRequired: true,
        },
        metadata: {
          llmModel: 'claude-sonnet-4-5-20250929',
          tokens: { input: 280, output: 32 },
          latencyMs: 2100,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(mockEvent);
      
      // Verify DynamoDB put
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item).toMatchObject({
        classification: 'SYSTEMIC',
        actionTaken: 'ESCALATED',
      });
      
      // Verify EventBridge routing
      const ebCall = ebMock.commandCalls(PutEventsCommand)[0];
      expect(ebCall.args[0].input.Entries![0]).toMatchObject({
        DetailType: 'SystemicFailure',
      });
    });

    it('should include semantic hash in DynamoDB record', async () => {
      const mockClassificationResult = {
        category: 'TRANSIENT' as const,
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: {
          action: 'REPLAY' as const,
          retryDelaySeconds: 30,
          maxRetries: 3,
          humanReviewRequired: false,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 50,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(mockEvent);
      
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item.semanticHash).toBeDefined();
      expect(typeof putCall.args[0].input.Item.semanticHash).toBe('string');
    });

    it('should include TTL in DynamoDB record', async () => {
      const mockClassificationResult = {
        category: 'TRANSIENT' as const,
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: {
          action: 'REPLAY' as const,
          retryDelaySeconds: 30,
          maxRetries: 3,
          humanReviewRequired: false,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 50,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(mockEvent);
      
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item.ttl).toBeDefined();
      expect(putCall.args[0].input.Item.ttl).toBeGreaterThan(Date.now() / 1000);
    });

    it('should handle classification errors', async () => {
      mockClassify.mockRejectedValue(new Error('Classification failed'));
      
      await expect(handler(mockEvent)).rejects.toThrow('Classification failed');
    });

    it('should truncate error message to 500 chars', async () => {
      const longErrorMessage = 'A'.repeat(1000);
      const messageWithLongError = {
        ...mockEvent,
        detail: {
          ...mockMessage,
          enrichment: {
            ...mockMessage.enrichment,
            errorPattern: {
              ...mockMessage.enrichment.errorPattern,
              errorMessage: longErrorMessage,
            },
          },
        },
      };
      
      const mockClassificationResult = {
        category: 'POISON_PILL' as const,
        confidence: 0.88,
        reasoning: 'Data error',
        recommendedAction: {
          action: 'ARCHIVE' as const,
          humanReviewRequired: true,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 50,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(messageWithLongError);
      
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item.errorMessage.length).toBeLessThanOrEqual(500);
    });

    it('should set retryScheduledFor for REPLAY actions', async () => {
      const mockClassificationResult = {
        category: 'TRANSIENT' as const,
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: {
          action: 'REPLAY' as const,
          retryDelaySeconds: 60,
          maxRetries: 3,
          humanReviewRequired: false,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 50,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      const beforeTime = Date.now();
      await handler(mockEvent);
      const afterTime = Date.now();
      
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item.retryScheduledFor).toBeDefined();
      expect(putCall.args[0].input.Item.retryScheduledFor!).toBeGreaterThan(beforeTime);
      expect(putCall.args[0].input.Item.retryScheduledFor!).toBeGreaterThanOrEqual(
        beforeTime + 60 * 1000
      );
    });

    it('should include suspected deployment if recent deployments exist', async () => {
      const messageWithDeployment = {
        ...mockEvent,
        detail: {
          ...mockMessage,
          enrichment: {
            ...mockMessage.enrichment,
            recentDeployments: [
              {
                deploymentId: 'deploy-123',
                version: 'v1.2.3',
                deployedAt: Date.now(),
                committedBy: 'john.doe',
                diff_url: 'https://github.com/org/repo/compare/v1.2.2...v1.2.3',
              },
            ],
          },
        },
      };
      
      const mockClassificationResult = {
        category: 'SYSTEMIC' as const,
        confidence: 0.92,
        reasoning: 'Deployment correlation',
        recommendedAction: {
          action: 'ESCALATE' as const,
          escalationSeverity: 'P1' as const,
          humanReviewRequired: true,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 50,
          cacheHit: false,
        },
      };
      
      mockClassify.mockResolvedValue(mockClassificationResult);
      ddbMock.on(PutCommand).resolves({});
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      
      await handler(messageWithDeployment);
      
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item.suspectedDeployment).toBe('v1.2.3');
    });
  });
});

