/**
 * Unit tests for classification module
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { EnrichedDLQMessage } from '@queuemint/shared';
import { mockClient } from 'aws-sdk-client-mock';

import { FailureClassifier } from '../src/classification';
import { LLMClient } from '../src/llm-client';


// Mock AWS SDK
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock LLM client
const mockLLMClient = {
  classifyFailure: jest.fn(),
} as unknown as LLMClient;

describe('FailureClassifier', () => {
  let classifier: FailureClassifier;

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

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    classifier = new FailureClassifier(mockLLMClient, ddbMock as any);
  });

  describe('classify - caching', () => {
    it('should return cached result if available', async () => {
      const cachedResult = {
        category: 'TRANSIENT' as const,
        confidence: 0.95,
        reasoning: 'Cached result',
        recommendedAction: {
          action: 'REPLAY' as const,
          retryDelaySeconds: 30,
          maxRetries: 3,
          humanReviewRequired: false,
        },
        metadata: {
          llmModel: 'claude-sonnet-4-5-20250929',
          tokens: { input: 200, output: 20 },
          latencyMs: 1500,
          cacheHit: false,
          cachedAt: Date.now(),
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: cachedResult });
      
      const result = await classifier.classify(mockMessage);
      
      expect(result.category).toBe('TRANSIENT');
      expect(result.metadata.cacheHit).toBe(true);
      expect(mockLLMClient.classifyFailure).not.toHaveBeenCalled();
    });

    it('should not use cached result if expired', async () => {
      // Use a message with unknown error that won't match heuristics
      const unknownErrorMessage: EnrichedDLQMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          similarFailuresLast1h: 1, // Below systemic threshold
          recentDeployments: [],
          errorPattern: {
            errorType: 'UnknownError',
            errorMessage: 'Something went wrong',
            stackTrace: 'at unknown (file.js:1)',
            errorCode: 'UNKNOWN',
            affectedService: 'test-service',
          },
        },
      };
      
      const expiredCacheResult = {
        category: 'TRANSIENT' as const,
        confidence: 0.95,
        reasoning: 'Expired cache',
        recommendedAction: {
          action: 'REPLAY' as const,
          retryDelaySeconds: 30,
          maxRetries: 3,
          humanReviewRequired: false,
        },
        metadata: {
          llmModel: 'claude-sonnet-4-5-20250929',
          tokens: { input: 200, output: 20 },
          latencyMs: 1500,
          cacheHit: false,
          cachedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: expiredCacheResult });
      ddbMock.on(PutCommand).resolves({});
      
      (mockLLMClient.classifyFailure as jest.Mock).mockResolvedValue({
        classification: {
          category: 'TRANSIENT',
          confidence: 0.92,
          reasoning: 'Fresh LLM result',
        },
        inputTokens: 250,
        outputTokens: 30,
        latencyMs: 2000,
      });
      
      const result = await classifier.classify(unknownErrorMessage);
      
      expect(result.metadata.cacheHit).toBe(false);
      expect(mockLLMClient.classifyFailure).toHaveBeenCalled();
    });
  });

  describe('classify - heuristics', () => {
    it('should use heuristic for known transient pattern', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(mockMessage);
      
      expect(result.category).toBe('TRANSIENT');
      expect(result.reasoning).toContain('Heuristic rule');
      expect(result.metadata.llmModel).toBe('heuristic');
      expect(mockLLMClient.classifyFailure).not.toHaveBeenCalled();
    });

    it('should detect systemic issue from spike + deployment correlation', async () => {
      const messageWithSpike = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          similarFailuresLast1h: 15,
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
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(messageWithSpike);
      
      expect(result.category).toBe('SYSTEMIC');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.reasoning).toContain('similar failures');
    });

    it('should use heuristic for poison pill patterns', async () => {
      const poisonPillMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          errorPattern: {
            errorType: 'TypeError',
            errorMessage: 'Cannot read property "foo" of null',
            stackTrace: 'at handler (index.js:15)',
            errorCode: 'TypeError',
            affectedService: 'webhook-service',
          },
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(poisonPillMessage);
      
      expect(result.category).toBe('POISON_PILL');
      expect(result.metadata.llmModel).toBe('heuristic');
    });
  });

  describe('classify - LLM', () => {
    it('should use LLM for ambiguous cases', async () => {
      const ambiguousMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          errorPattern: {
            errorType: 'UnknownError',
            errorMessage: 'Something went wrong',
            stackTrace: 'at handler (index.js:10)',
            errorCode: 'UNKNOWN',
            affectedService: 'webhook-service',
          },
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      (mockLLMClient.classifyFailure as jest.Mock).mockResolvedValue({
        classification: {
          category: 'SYSTEMIC',
          confidence: 0.75,
          reasoning: 'Unclear error, needs investigation',
        },
        inputTokens: 300,
        outputTokens: 35,
        latencyMs: 2500,
      });
      
      const result = await classifier.classify(ambiguousMessage);
      
      expect(result.category).toBe('SYSTEMIC');
      expect(result.confidence).toBe(0.75);
      expect(result.metadata.llmModel).toContain('claude');
      expect(mockLLMClient.classifyFailure).toHaveBeenCalled();
    });

    it('should cache LLM result', async () => {
      const ambiguousMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          errorPattern: {
            errorType: 'UnknownError',
            errorMessage: 'Something went wrong',
            stackTrace: undefined,
            errorCode: 'UNKNOWN',
            affectedService: 'webhook-service',
          },
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      (mockLLMClient.classifyFailure as jest.Mock).mockResolvedValue({
        classification: {
          category: 'POISON_PILL',
          confidence: 0.82,
          reasoning: 'Data validation issue',
        },
        inputTokens: 280,
        outputTokens: 28,
        latencyMs: 2200,
      });
      
      await classifier.classify(ambiguousMessage);
      
      expect(ddbMock.commandCalls(PutCommand).length).toBeGreaterThan(0);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item).toMatchObject({
        category: 'POISON_PILL',
        confidence: 0.82,
      });
    });

    it('should fallback to SYSTEMIC on LLM failure', async () => {
      const ambiguousMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          errorPattern: {
            errorType: 'UnknownError',
            errorMessage: 'Something went wrong',
            stackTrace: undefined,
            errorCode: 'UNKNOWN',
            affectedService: 'webhook-service',
          },
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      
      (mockLLMClient.classifyFailure as jest.Mock).mockRejectedValue(
        new Error('API rate limit exceeded')
      );
      
      const result = await classifier.classify(ambiguousMessage);
      
      expect(result.category).toBe('SYSTEMIC');
      expect(result.confidence).toBeLessThan(0.7);
      expect(result.reasoning).toContain('failed');
      expect(result.metadata.llmModel).toBe('fallback');
    });
  });

  describe('recommended actions', () => {
    it('should recommend REPLAY for transient failures', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(mockMessage);
      
      expect(result.recommendedAction.action).toBe('REPLAY');
      expect(result.recommendedAction.retryDelaySeconds).toBeGreaterThan(0);
      expect(result.recommendedAction.maxRetries).toBe(3);
      expect(result.recommendedAction.humanReviewRequired).toBe(false);
    });

    it('should calculate exponential backoff for retries', async () => {
      const messageWithRetries = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          retryCount: 2,
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(messageWithRetries);
      
      expect(result.recommendedAction.retryDelaySeconds).toBeGreaterThan(30);
      expect(result.recommendedAction.retryDelaySeconds).toBeLessThanOrEqual(900); // Max 15 min
    });

    it('should recommend ARCHIVE for poison pills', async () => {
      const poisonPillMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          errorPattern: {
            errorType: 'TypeError',
            errorMessage: 'Cannot read property "foo" of null',
            stackTrace: 'at handler (index.js:15)',
            errorCode: 'TypeError',
            affectedService: 'webhook-service',
          },
        },
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(poisonPillMessage);
      
      expect(result.recommendedAction.action).toBe('ARCHIVE');
      expect(result.recommendedAction.humanReviewRequired).toBe(true);
    });

    it('should recommend ESCALATE for systemic issues', async () => {
      const systemicMessage = {
        ...mockMessage,
        enrichment: {
          ...mockMessage.enrichment,
          similarFailuresLast1h: 15,
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
      };
      
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});
      
      const result = await classifier.classify(systemicMessage);
      
      expect(result.recommendedAction.action).toBe('ESCALATE');
      expect(result.recommendedAction.escalationSeverity).toBe('P1');
      expect(result.recommendedAction.humanReviewRequired).toBe(true);
    });
  });
});
