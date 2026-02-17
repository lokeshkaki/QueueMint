/**
 * Unit tests for systemic failure handler
 */

import type { EnrichedDLQMessage } from '@queuemint/shared';

import { handleSystemicFailure } from '../src/systemic-handler';
import type { ActionContext } from '../src/types';

// Mock global fetch
global.fetch = jest.fn();

describe('systemic-handler', () => {
  const mockMessage: EnrichedDLQMessage = {
    messageId: 'msg-789',
    receiptHandle: 'handle-789',
    body: JSON.stringify({ data: 'test' }),
    attributes: {
      approximateReceiveCount: 5,
      sentTimestamp: Date.now(),
      approximateFirstReceiveTimestamp: Date.now(),
    },
    sourceQueue: 'api-dlq',
    enrichment: {
      retryCount: 4,
      firstSeenAt: Date.now() - 60000,
      lastFailedAt: Date.now(),
      similarFailuresLast1h: 25,
      recentDeployments: [
        {
          service: 'api-service',
          version: 'v2.3.1',
          timestamp: Date.now() - 30000,
        },
      ],
      errorPattern: {
        errorType: 'DatabaseConnectionError',
        errorMessage: 'Connection pool exhausted',
        stackTrace: 'at connect (db.js:20)',
        errorCode: 'CONN_POOL_EXHAUSTED',
        affectedService: 'api-service',
      },
    },
  };

  const mockClassification = {
    category: 'SYSTEMIC' as const,
    confidence: 0.92,
    reasoning: 'Spike in similar failures after recent deployment',
    recommendedAction: {
      action: 'ESCALATE' as const,
      escalationSeverity: 'P1' as const,
      humanReviewRequired: true,
    },
    metadata: {
      llmModel: 'heuristic',
      tokens: { input: 0, output: 0 },
      latencyMs: 2,
      cacheHit: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSystemicFailure', () => {
    it('should create PagerDuty incident successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          message: 'Event processed',
          dedup_key: 'queuemint-systemic-api-dlq-DatabaseConnectionError',
        }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handleSystemicFailure(context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('ESCALATE');
      expect(result.messageId).toBe('msg-789');
      expect(result.details?.pagerDutyIncidentId).toBe(
        'queuemint-systemic-api-dlq-DatabaseConnectionError'
      );
    });

    it('should send correct PagerDuty event payload', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          dedup_key: 'test-dedup-key',
        }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handleSystemicFailure(context);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://events.pagerduty.com/v2/enqueue',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.event_action).toBe('trigger');
      expect(requestBody.payload.summary).toContain('Systemic failure detected');
      expect(requestBody.payload.summary).toContain('api-dlq');
      expect(requestBody.payload.severity).toBe('critical'); // P1 maps to critical
      expect(requestBody.payload.source).toBe('queuemint-dlq-api-dlq');
    });

    it('should include complete custom details in PagerDuty event', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', dedup_key: 'test-key' }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handleSystemicFailure(context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      const customDetails = requestBody.payload.custom_details;

      expect(customDetails).toHaveProperty('message_id', 'msg-789');
      expect(customDetails).toHaveProperty('source_queue', 'api-dlq');
      expect(customDetails).toHaveProperty('error_type', 'DatabaseConnectionError');
      expect(customDetails).toHaveProperty('similar_failures_last_hour', 25);
      expect(customDetails).toHaveProperty('recent_deployments');
      expect(customDetails.recent_deployments).toHaveLength(1);
      expect(customDetails).toHaveProperty('classification');
      expect(customDetails.classification.category).toBe('SYSTEMIC');
    });

    it('should use correct deduplication key', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', dedup_key: 'test-key' }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      await handleSystemicFailure(context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.dedup_key).toBe(
        'queuemint-systemic-api-dlq-DatabaseConnectionError'
      );
      expect(requestBody.client).toBe('QueueMint Self-Healing DLQ');
    });

    it('should map P1 severity to critical', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', dedup_key: 'test-key' }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: {
          ...mockClassification,
          recommendedAction: {
            ...mockClassification.recommendedAction,
            escalationSeverity: 'P1',
          },
        },
      };

      await handleSystemicFailure(context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.payload.severity).toBe('critical');
    });

    it('should map P2 severity to error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', dedup_key: 'test-key' }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: {
          ...mockClassification,
          recommendedAction: {
            ...mockClassification.recommendedAction,
            escalationSeverity: 'P2',
          },
        },
      };

      await handleSystemicFailure(context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.payload.severity).toBe('error');
    });

    it('should map P3 severity to warning', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', dedup_key: 'test-key' }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: {
          ...mockClassification,
          recommendedAction: {
            ...mockClassification.recommendedAction,
            escalationSeverity: 'P3',
          },
        },
      };

      await handleSystemicFailure(context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.payload.severity).toBe('warning');
    });

    it('should default to error severity if not specified', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', dedup_key: 'test-key' }),
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: {
          ...mockClassification,
          recommendedAction: {
            action: 'ESCALATE',
            humanReviewRequired: true,
            // No escalationSeverity
          },
        },
      };

      await handleSystemicFailure(context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.payload.severity).toBe('error');
    });

    it('should handle PagerDuty API errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handleSystemicFailure(context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('ESCALATE');
      expect(result.details?.error).toContain('PagerDuty API error 429');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error('Network request failed')
      );

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handleSystemicFailure(context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('ESCALATE');
      expect(result.details?.error).toBe('Network request failed');
    });

    it('should handle malformed PagerDuty responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const context: ActionContext = {
        message: mockMessage,
        classification: mockClassification,
      };

      const result = await handleSystemicFailure(context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('ESCALATE');
      expect(result.details?.error).toBe('Invalid JSON');
    });
  });
});
