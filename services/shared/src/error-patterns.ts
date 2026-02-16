/**
 * Known error patterns for heuristic classification
 */

export interface ErrorPatternRule {
  /** Pattern name */
  name: string;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Classification category */
  category: 'TRANSIENT' | 'POISON_PILL' | 'SYSTEMIC';
  /** Confidence score */
  confidence: number;
  /** Human-readable description */
  description: string;
}

/**
 * Known transient error patterns (network issues, rate limits, timeouts)
 */
export const TRANSIENT_PATTERNS: ErrorPatternRule[] = [
  {
    name: 'Network Timeout',
    pattern: /ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up|timeout of \d+ms exceeded/i,
    category: 'TRANSIENT',
    confidence: 0.96,
    description: 'Network timeout - temporary connectivity issue',
  },
  {
    name: 'Connection Refused',
    pattern: /ECONNREFUSED|connection refused|connect ECONNREFUSED/i,
    category: 'TRANSIENT',
    confidence: 0.94,
    description: 'Connection refused - service temporarily unavailable',
  },
  {
    name: 'HTTP 429 Rate Limit',
    pattern: /429|Too Many Requests|rate limit exceeded|throttled/i,
    category: 'TRANSIENT',
    confidence: 0.98,
    description: 'Rate limit - too many requests to API',
  },
  {
    name: 'HTTP 503 Service Unavailable',
    pattern: /503|Service Unavailable|service is unavailable/i,
    category: 'TRANSIENT',
    confidence: 0.95,
    description: 'Service unavailable - temporary outage',
  },
  {
    name: 'HTTP 504 Gateway Timeout',
    pattern: /504|Gateway Timeout|gateway timeout/i,
    category: 'TRANSIENT',
    confidence: 0.95,
    description: 'Gateway timeout - upstream service slow',
  },
  {
    name: 'AWS Throttling',
    pattern: /ThrottlingException|RequestLimitExceeded|ProvisionedThroughputExceededException/i,
    category: 'TRANSIENT',
    confidence: 0.97,
    description: 'AWS API throttling - exceeded service limits',
  },
  {
    name: 'DNS Resolution Failure',
    pattern: /ENOTFOUND|getaddrinfo|DNS resolution failed/i,
    category: 'TRANSIENT',
    confidence: 0.93,
    description: 'DNS resolution failure - temporary network issue',
  },
  {
    name: 'Connection Reset',
    pattern: /ECONNRESET|connection reset|reset by peer/i,
    category: 'TRANSIENT',
    confidence: 0.92,
    description: 'Connection reset - network interruption',
  },
];

/**
 * Known poison pill patterns (data corruption, schema errors)
 */
export const POISON_PILL_PATTERNS: ErrorPatternRule[] = [
  {
    name: 'Null Pointer',
    pattern: /Cannot read propert(?:y|ies) .* of (?:null|undefined)|null pointer|NullPointerException/i,
    category: 'POISON_PILL',
    confidence: 0.89,
    description: 'Null pointer - missing or corrupt data',
  },
  {
    name: 'JSON Parse Error',
    pattern: /JSON.parse|Unexpected token|invalid JSON|malformed JSON/i,
    category: 'POISON_PILL',
    confidence: 0.91,
    description: 'JSON parse error - malformed message payload',
  },
  {
    name: 'Schema Validation',
    pattern: /schema validation|required field|missing required|invalid format/i,
    category: 'POISON_PILL',
    confidence: 0.88,
    description: 'Schema validation failure - incorrect data structure',
  },
  {
    name: 'Type Mismatch',
    pattern: /TypeError|type mismatch|expected .* but got|is not a function/i,
    category: 'POISON_PILL',
    confidence: 0.87,
    description: 'Type mismatch - incorrect data type',
  },
  {
    name: 'Division by Zero',
    pattern: /division by zero|divide by zero/i,
    category: 'POISON_PILL',
    confidence: 0.95,
    description: 'Division by zero - invalid calculation',
  },
  {
    name: 'Invalid Argument',
    pattern: /invalid argument|illegal argument|argument .* is invalid/i,
    category: 'POISON_PILL',
    confidence: 0.86,
    description: 'Invalid argument - bad input data',
  },
];

/**
 * Combine all patterns for easy access
 */
export const ALL_ERROR_PATTERNS: ErrorPatternRule[] = [
  ...TRANSIENT_PATTERNS,
  ...POISON_PILL_PATTERNS,
];

/**
 * Match error message against known patterns
 */
export function matchErrorPattern(errorMessage: string): ErrorPatternRule | null {
  for (const pattern of ALL_ERROR_PATTERNS) {
    if (pattern.pattern.test(errorMessage)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if error is likely transient based on patterns
 */
export function isLikelyTransient(errorMessage: string): boolean {
  const match = matchErrorPattern(errorMessage);
  return match?.category === 'TRANSIENT' || false;
}

/**
 * Check if error is likely a poison pill based on patterns
 */
export function isLikelyPoisonPill(errorMessage: string): boolean {
  const match = matchErrorPattern(errorMessage);
  return match?.category === 'POISON_PILL' || false;
}
