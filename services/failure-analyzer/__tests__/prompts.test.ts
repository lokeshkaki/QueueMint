/**
 * Unit tests for prompts module
 */

import type { EnrichedDLQMessage } from '@queuemint/shared';

import { buildUserPrompt, redactPII } from '../src/prompts';

describe('redactPII', () => {
  it('should redact email addresses', () => {
    const text = 'User john.doe@example.com failed authentication';
    const redacted = redactPII(text);
    expect(redacted).toBe('User [EMAIL_REDACTED] failed authentication');
  });

  it('should redact credit card numbers', () => {
    const text = 'Payment failed for card 4532-1234-5678-9010';
    const redacted = redactPII(text);
    expect(redacted).toBe('Payment failed for card [CC_REDACTED]');
  });

  it('should redact SSN patterns', () => {
    const text = 'SSN 123-45-6789 invalid';
    const redacted = redactPII(text);
    expect(redacted).toBe('SSN [SSN_REDACTED] invalid');
  });

  it('should redact API keys', () => {
    const text = 'API key sk_test_XXXXXXXXXXXXXXXXXXXX';
    const redacted = redactPII(text);
    expect(redacted).toBe('API key [API_KEY_REDACTED]');
  });

  it('should handle multiple PII patterns in one string', () => {
    const text = 'User test@example.com with SSN 123-45-6789 and card 1234-5678-9012-3456';
    const redacted = redactPII(text);
    expect(redacted).toContain('[EMAIL_REDACTED]');
    expect(redacted).toContain('[SSN_REDACTED]');
    expect(redacted).toContain('[CC_REDACTED]');
  });
});

describe('buildUserPrompt', () => {
  const mockMessage: EnrichedDLQMessage = {
    messageId: 'msg-123',
    receiptHandle: 'handle-123',
    body: JSON.stringify({ data: 'test' }),
    attributes: {
      approximateReceiveCount: 3,
      sentTimestamp: Date.now(),
      approximateFirstReceiveTimestamp: Date.now(),
    },
    sourceQueue: 'webhook-dlq',
    enrichment: {
      retryCount: 2,
      firstSeenAt: Date.now(),
      lastFailedAt: Date.now(),
      similarFailuresLast1h: 5,
      recentDeployments: [
        {
          deploymentId: 'deploy-123',
          version: 'v1.2.3',
          deployedAt: Date.now(),
          committedBy: 'john.doe',
          diff_url: 'https://github.com/org/repo/compare/v1.2.2...v1.2.3',
        },
      ],
      errorPattern: {
        errorType: 'NetworkError',
        errorMessage: 'ETIMEDOUT: connection timeout',
        stackTrace: 'at handler (index.js:10)\nat wrapper (lambda.js:5)\nat runtime.js:20',
        errorCode: 'ETIMEDOUT',
        affectedService: 'webhook-service',
      },
    },
  };

  it('should build user prompt with all context', () => {
    const prompt = buildUserPrompt(mockMessage);
    
    expect(prompt).toContain('NetworkError');
    expect(prompt).toContain('ETIMEDOUT');
    expect(prompt).toContain('connection timeout');
    expect(prompt).toContain('Retry Count: 2');
    expect(prompt).toContain('Similar Failures (last 1 hour): 5');
    expect(prompt).toContain('webhook-service');
    expect(prompt).toContain('v1.2.3');
    expect(prompt).toContain('john.doe');
  });

  it('should truncate message body to 500 chars', () => {
    const longBody = 'A'.repeat(1000);
    const messageWithLongBody = {
      ...mockMessage,
      body: longBody,
    };
    
    const prompt = buildUserPrompt(messageWithLongBody);
    expect(prompt).toContain('[truncated]');
  });

  it('should redact PII from error message and stack trace', () => {
    const messageWithPII = {
      ...mockMessage,
      enrichment: {
        ...mockMessage.enrichment,
        errorPattern: {
          ...mockMessage.enrichment.errorPattern,
          errorMessage: 'Failed for user test@example.com',
          stackTrace: 'at processUser (user-123-456-789.js:10)',
        },
      },
    };
    
    const prompt = buildUserPrompt(messageWithPII);
    expect(prompt).toContain('[EMAIL_REDACTED]');
    expect(prompt).not.toContain('test@example.com');
  });

  it('should handle missing stack trace', () => {
    const messageNoStack = {
      ...mockMessage,
      enrichment: {
        ...mockMessage.enrichment,
        errorPattern: {
          ...mockMessage.enrichment.errorPattern,
          stackTrace: undefined,
        },
      },
    };
    
    const prompt = buildUserPrompt(messageNoStack);
    expect(prompt).toContain('N/A');
  });

  it('should handle no recent deployments', () => {
    const messageNoDeploys = {
      ...mockMessage,
      enrichment: {
        ...mockMessage.enrichment,
        recentDeployments: [],
      },
    };
    
    const prompt = buildUserPrompt(messageNoDeploys);
    expect(prompt).toContain('(None detected in last 15 minutes)');
  });
});
