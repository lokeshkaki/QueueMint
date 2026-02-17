/**
 * Unit tests for LLM client module
 */

import Anthropic from '@anthropic-ai/sdk';
import type { EnrichedDLQMessage } from '@queuemint/shared';

import { LLMClient } from '../src/llm-client';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk');

describe('LLMClient', () => {
  let client: LLMClient;
  let mockCreate: jest.Mock;

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
    jest.clearAllMocks();
    
    mockCreate = jest.fn();
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    } as any));
    
    client = new LLMClient('test-api-key');
  });

  describe('classifyFailure', () => {
    it('should successfully classify a failure', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'TRANSIENT',
              confidence: 0.95,
              reasoning: 'Network timeout is a temporary issue',
            }),
          },
        ],
        usage: {
          input_tokens: 250,
          output_tokens: 30,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      const result = await client.classifyFailure(mockMessage);
      
      expect(result.classification.category).toBe('TRANSIENT');
      expect(result.classification.confidence).toBe(0.95);
      expect(result.classification.reasoning).toContain('Network timeout');
      expect(result.inputTokens).toBe(250);
      expect(result.outputTokens).toBe(30);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should parse JSON with markdown code fences', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: '```json\n{"category": "POISON_PILL", "confidence": 0.88, "reasoning": "Null pointer error"}\n```',
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 25,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      const result = await client.classifyFailure(mockMessage);
      
      expect(result.classification.category).toBe('POISON_PILL');
      expect(result.classification.confidence).toBe(0.88);
    });

    it('should validate category values', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'INVALID_CATEGORY',
              confidence: 0.9,
              reasoning: 'Test',
            }),
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 20,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      await expect(client.classifyFailure(mockMessage)).rejects.toThrow('Invalid category');
    });

    it('should validate confidence range', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'TRANSIENT',
              confidence: 1.5,
              reasoning: 'Test',
            }),
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 20,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      await expect(client.classifyFailure(mockMessage)).rejects.toThrow('Invalid confidence');
    });

    it('should validate reasoning presence', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'TRANSIENT',
              confidence: 0.9,
              reasoning: '',
            }),
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 20,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      await expect(client.classifyFailure(mockMessage)).rejects.toThrow('Missing reasoning');
    });

    it('should handle API errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));
      
      await expect(client.classifyFailure(mockMessage)).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle invalid JSON response', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: 'This is not JSON',
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 20,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      await expect(client.classifyFailure(mockMessage)).rejects.toThrow('Failed to parse LLM response');
    });

    it('should call Claude API with correct parameters', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'TRANSIENT',
              confidence: 0.9,
              reasoning: 'Test',
            }),
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 20,
        },
      };
      
      mockCreate.mockResolvedValue(mockResponse);
      
      await client.classifyFailure(mockMessage);
      
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: expect.any(Number),
          temperature: expect.any(Number),
          system: expect.stringContaining('expert failure classifier'),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('ETIMEDOUT'),
            }),
          ]),
        })
      );
    });
  });
});
