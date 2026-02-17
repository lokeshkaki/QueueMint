/**
 * LLM prompts for failure classification
 */

import type { EnrichedDLQMessage } from '@queuemint/shared';

/**
 * System prompt for Claude API
 * Defines the classification task and output format
 */
export const SYSTEM_PROMPT = `You are an expert failure classifier for a distributed system's Dead Letter Queue (DLQ).

Your task is to classify failures into ONE of three categories:

1. **TRANSIENT** - Temporary failures that will likely succeed if retried:
   - Network timeouts, connection errors, DNS failures
   - Rate limiting (HTTP 429), service unavailable (HTTP 503/504)
   - AWS throttling exceptions
   - Temporary resource exhaustion

2. **POISON_PILL** - Bad data that will never succeed, regardless of retries:
   - Null pointer exceptions, type errors
   - JSON parse errors, schema validation failures
   - Division by zero, invalid arguments
   - Data corruption or missing required fields

3. **SYSTEMIC** - System-wide issues requiring immediate human intervention:
   - Spike in similar failures (>10 in 15 minutes) correlated with recent deployment
   - Database connection pool exhausted
   - Configuration errors affecting multiple messages
   - Critical service dependencies down

Analyze the error message, stack trace, retry count, similar failure count, and recent deployments.

Respond ONLY with valid JSON in this exact format:
{
  "category": "TRANSIENT" | "POISON_PILL" | "SYSTEMIC",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation (1-2 sentences)"
}

Be decisive. If unsure, classify as SYSTEMIC for human review.`;

/**
 * Redact PII from text
 * Removes: emails, credit cards, SSNs, API keys
 */
export function redactPII(text: string): string {
  let redacted = text;
  
  // Email addresses
  redacted = redacted.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    '[EMAIL_REDACTED]'
  );
  
  // Credit card numbers (basic pattern)
  redacted = redacted.replace(
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    '[CC_REDACTED]'
  );
  
  // SSN patterns
  redacted = redacted.replace(
    /\b\d{3}-\d{2}-\d{4}\b/g,
    '[SSN_REDACTED]'
  );
  
  // API keys (common patterns: sk_live_..., pk_test_..., api_key_...)
  redacted = redacted.replace(
    /\b(sk|pk|api|key)(_)?(live|test)?(_)?[a-zA-Z0-9]{20,}\b/gi,
    '[API_KEY_REDACTED]'
  );
  
  return redacted;
}

/**
 * Build user prompt from enriched message
 * Includes error details, context, and deployment info
 */
export function buildUserPrompt(message: EnrichedDLQMessage): string {
  const {
    body,
    enrichment: {
      errorPattern,
      retryCount,
      similarFailuresLast1h,
      recentDeployments,
    },
  } = message;
  
  // Truncate body to 500 chars for cost efficiency
  const truncatedBody = body.length > 500
    ? body.substring(0, 500) + '...[truncated]'
    : body;
  
  // Redact PII from error message and stack trace
  const redactedError = redactPII(errorPattern.errorMessage);
  const redactedStack = errorPattern.stackTrace
    ? redactPII(errorPattern.stackTrace)
    : 'N/A';
  const redactedBody = redactPII(truncatedBody);
  
  // Format deployment info
  const deploymentInfo = recentDeployments.length > 0
    ? recentDeployments
        .map((d) => `  - ${d.version} by ${d.committedBy} at ${new Date(d.deployedAt).toISOString()}`)
        .join('\n')
    : '  (None detected in last 15 minutes)';
  
  return `Analyze this DLQ failure:

**Error Type:** ${errorPattern.errorType}
**Error Code:** ${errorPattern.errorCode || 'N/A'}
**Error Message:** ${redactedError}

**Stack Trace (top 3 frames):**
${redactedStack}

**Message Body (truncated):**
${redactedBody}

**Context:**
- Retry Count: ${retryCount}
- Similar Failures (last 1 hour): ${similarFailuresLast1h}
- Affected Service: ${errorPattern.affectedService}
- Source Queue: ${message.sourceQueue}

**Recent Deployments (last 15 minutes):**
${deploymentInfo}

Classify this failure and provide confidence score and reasoning.`;
}
