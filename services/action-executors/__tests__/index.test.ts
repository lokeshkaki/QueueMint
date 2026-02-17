/**
 * Unit tests for action executors main handler
 */

import type { EnrichedDLQMessage, ClassificationResult } from '@queuemint/shared';
import type { EventBridgeEvent } from 'aws-lambda';

import { handler } from '../src/index';
import * as poisonPillHandler from '../src/poison-pill-handler';
import * as systemicHandler from '../src/systemic-handler';
import * as transientHandler from '../src/transient-handler';

// Mock handlers
jest.mock('../src/transient-handler');
jest.mock('../src/poison-pill-handler');
jest.mock('../src/systemic-handler');

describe('Action Executors - Main Handler', () => {
  const mockMessage: EnrichedDLQMessage = {
    messageId: 'msg-test',
    receiptHandle: 'handle-test',
    body: JSON.stringify({ data: 'test' }),
    attributes: {
      approximateReceiveCount: 1,
      sentTimestamp: Date.now(),
      approximateFirstReceiveTimestamp: Date.now(),
    },
    sourceQueue: 'test-dlq',
    enrichment: {
      retryCount: 0,
      firstSeenAt: Date.now(),
      lastFailedAt: Date.now(),
      similarFailuresLast1h: 3,
      recentDeployments: [],
      errorPattern: {
        errorType: 'TestError',
        errorMessage: 'Test error message',
        stackTrace: 'at test (test.js:1)',
        errorCode: 'TEST_ERROR',
        affectedService: 'test-service',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('routing', () => {
    it('should route TRANSIENT classification to transient handler', async () => {
      const mockResult = {
        success: true,
        action: 'REPLAY',
        messageId: 'msg-test',
      };
      
      (transientHandler.handleTransientFailure as jest.Mock).mockResolvedValue(mockResult);

      const classification: ClassificationResult = {
        category: 'TRANSIENT',
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: { action: 'REPLAY', humanReviewRequired: false },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 5,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await handler(event);

      expect(transientHandler.handleTransientFailure).toHaveBeenCalledWith({
        message: mockMessage,
        classification,
      });
      expect(poisonPillHandler.handlePoisonPill).not.toHaveBeenCalled();
      expect(systemicHandler.handleSystemicFailure).not.toHaveBeenCalled();
    });

    it('should route POISON_PILL classification to poison pill handler', async () => {
      const mockResult = {
        success: true,
        action: 'ARCHIVE',
        messageId: 'msg-test',
        details: { s3Key: 'test-key' },
      };
      
      (poisonPillHandler.handlePoisonPill as jest.Mock).mockResolvedValue(mockResult);

      const classification: ClassificationResult = {
        category: 'POISON_PILL',
        confidence: 0.88,
        reasoning: 'Null pointer exception',
        recommendedAction: { action: 'ARCHIVE', humanReviewRequired: true },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 3,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await handler(event);

      expect(poisonPillHandler.handlePoisonPill).toHaveBeenCalledWith({
        message: mockMessage,
        classification,
      });
      expect(transientHandler.handleTransientFailure).not.toHaveBeenCalled();
      expect(systemicHandler.handleSystemicFailure).not.toHaveBeenCalled();
    });

    it('should route SYSTEMIC classification to systemic handler', async () => {
      const mockResult = {
        success: true,
        action: 'ESCALATE',
        messageId: 'msg-test',
        details: { pagerDutyIncidentId: 'incident-123' },
      };
      
      (systemicHandler.handleSystemicFailure as jest.Mock).mockResolvedValue(mockResult);

      const classification: ClassificationResult = {
        category: 'SYSTEMIC',
        confidence: 0.92,
        reasoning: 'Spike after deployment',
        recommendedAction: {
          action: 'ESCALATE',
          escalationSeverity: 'P1',
          humanReviewRequired: true,
        },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 2,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await handler(event);

      expect(systemicHandler.handleSystemicFailure).toHaveBeenCalledWith({
        message: mockMessage,
        classification,
      });
      expect(transientHandler.handleTransientFailure).not.toHaveBeenCalled();
      expect(poisonPillHandler.handlePoisonPill).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error on unknown classification category', async () => {
      const classification = {
        category: 'UNKNOWN' as any,
        confidence: 0.5,
        reasoning: 'Unknown',
        recommendedAction: { action: 'REPLAY' as any, humanReviewRequired: false },
        metadata: {
          llmModel: 'test',
          tokens: { input: 0, output: 0 },
          latencyMs: 0,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await expect(handler(event)).rejects.toThrow('Unknown classification category');
    });

    it('should throw error if handler returns failure', async () => {
      const mockResult = {
        success: false,
        action: 'REPLAY',
        messageId: 'msg-test',
        details: { error: 'Handler failed' },
      };
      
      (transientHandler.handleTransientFailure as jest.Mock).mockResolvedValue(mockResult);

      const classification: ClassificationResult = {
        category: 'TRANSIENT',
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: { action: 'REPLAY', humanReviewRequired: false },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 5,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await expect(handler(event)).rejects.toThrow('Action execution failed: Handler failed');
    });

    it('should propagate handler exceptions', async () => {
      (transientHandler.handleTransientFailure as jest.Mock).mockRejectedValue(
        new Error('Unexpected handler error')
      );

      const classification: ClassificationResult = {
        category: 'TRANSIENT',
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: { action: 'REPLAY', humanReviewRequired: false },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 5,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await expect(handler(event)).rejects.toThrow('Unexpected handler error');
    });
  });

  describe('logging', () => {
    it('should log successful execution', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const mockResult = {
        success: true,
        action: 'REPLAY',
        messageId: 'msg-test',
        details: { replayDelaySeconds: 60 },
      };
      
      (transientHandler.handleTransientFailure as jest.Mock).mockResolvedValue(mockResult);

      const classification: ClassificationResult = {
        category: 'TRANSIENT',
        confidence: 0.95,
        reasoning: 'Network timeout',
        recommendedAction: { action: 'REPLAY', humanReviewRequired: false },
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: 5,
          cacheHit: false,
        },
      };

      const event = {
        'detail-type': 'MessageClassified',
        detail: { message: mockMessage, classification },
      } as EventBridgeEvent<'MessageClassified', any>;

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Action Executor triggered',
        expect.objectContaining({
          messageId: 'msg-test',
          sourceQueue: 'test-dlq',
          category: 'TRANSIENT',
          action: 'REPLAY',
        })
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        'Action executed successfully',
        expect.objectContaining({
          messageId: 'msg-test',
          action: 'REPLAY',
          details: { replayDelaySeconds: 60 },
        })
      );

      consoleSpy.mockRestore();
    });
  });
});

