/**
 * Constants used throughout QueueMint system
 */

/**
 * AWS configuration
 */
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * DynamoDB table names
 */
export const DYNAMODB_TABLES = {
  FAILURE_ANALYSIS: process.env.FAILURE_ANALYSIS_TABLE || 'pullmint-dlq-failure-analysis',
  MESSAGE_DEDUPLICATION: process.env.DEDUP_TABLE || 'pullmint-dlq-deduplication',
} as const;

/**
 * S3 bucket configuration
 */
export const S3_BUCKETS = {
  DLQ_ANALYSIS: process.env.DLQ_ANALYSIS_BUCKET || 'pullmint-dlq-analysis',
} as const;

export const S3_PREFIX = {
  POISON_PILLS: 'poison-pills',
  SYSTEMIC_ANALYSIS: 'systemic-analysis',
} as const;

/**
 * EventBridge configuration
 */
export const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'pullmint-event-bus';

/**
 * SNS Topics
 */
export const SNS_TOPICS = {
  POISON_PILLS: process.env.SNS_POISON_PILLS || 'pullmint-dlq-poison-pills',
  SYSTEMIC_ALERTS: process.env.SNS_SYSTEMIC_ALERTS || 'pullmint-dlq-systemic-alerts',
  ROLLBACK_SUGGESTIONS: process.env.SNS_ROLLBACK || 'pullmint-dlq-rollback-suggestions',
} as const;

/**
 * SSM Parameter Store paths for feature flags
 */
export const SSM_PARAMETERS = {
  AUTO_REPLAY_ENABLED: '/pullmint/dlq/features/autoReplayEnabled',
  LLM_CLASSIFICATION_ENABLED: '/pullmint/dlq/features/llmClassificationEnabled',
  PAGERDUTY_ENABLED: '/pullmint/dlq/features/pagerdutyIntegrationEnabled',
  CONFIDENCE_THRESHOLD: '/pullmint/dlq/config/confidenceThreshold',
  MAX_RETRIES: '/pullmint/dlq/config/maxRetries',
} as const;

/**
 * Secrets Manager
 */
export const SECRETS = {
  ANTHROPIC_API_KEY: 'pullmint/anthropic-api-key',
  PAGERDUTY_API_KEY: 'pullmint/pagerduty-api-key',
} as const;

/**
 * Classification thresholds
 */
export const CLASSIFICATION_THRESHOLDS = {
  /** Minimum confidence for auto-replay */
  TRANSIENT_MIN_CONFIDENCE: 0.85,
  /** Minimum confidence for poison pill classification */
  POISON_PILL_MIN_CONFIDENCE: 0.90,
  /** Minimum confidence for systemic classification */
  SYSTEMIC_MIN_CONFIDENCE: 0.95,
} as const;

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  /** Base delay in seconds */
  BASE_DELAY_SECONDS: 30,
  /** Maximum delay in seconds (15 minutes) */
  MAX_DELAY_SECONDS: 900,
  /** Maximum retry attempts */
  MAX_RETRIES: 3,
  /** Jitter range in seconds */
  JITTER_SECONDS: 1,
} as const;

/**
 * Systemic failure detection thresholds
 */
export const SYSTEMIC_THRESHOLDS = {
  /** Minimum similar failures to consider systemic */
  MIN_SIMILAR_FAILURES: 10,
  /** Time window for similar failures (milliseconds) */
  TIME_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  /** Deployment correlation window (milliseconds) */
  DEPLOYMENT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
} as const;

/**
 * LLM configuration
 */
export const LLM_CONFIG = {
  /** Primary model for complex classification */
  PRIMARY_MODEL: 'claude-sonnet-4.5-20241022',
  /** Fallback model for simple cases */
  FALLBACK_MODEL: 'claude-haiku-3.5-20241022',
  /** Temperature for deterministic output */
  TEMPERATURE: 0.2,
  /** Max tokens for response */
  MAX_TOKENS: 500,
  /** Request timeout (ms) */
  TIMEOUT_MS: 10000,
} as const;

/**
 * Caching configuration
 */
export const CACHE_CONFIG = {
  /** Semantic hash cache TTL (1 hour) */
  SEMANTIC_HASH_TTL_MS: 3600000,
  /** Classification result cache TTL */
  CLASSIFICATION_TTL_MS: 3600000,
} as const;

/**
 * Data retention
 */
export const DATA_RETENTION = {
  /** DynamoDB TTL (30 days) */
  DYNAMODB_TTL_DAYS: 30,
  /** S3 transition to IA (30 days) */
  S3_IA_TRANSITION_DAYS: 30,
  /** S3 transition to Glacier (90 days) */
  S3_GLACIER_TRANSITION_DAYS: 90,
  /** S3 deletion (365 days) */
  S3_EXPIRATION_DAYS: 365,
} as const;

/**
 * CloudWatch metrics namespace
 */
export const CLOUDWATCH_NAMESPACE = 'Pullmint/DLQ';

/**
 * CloudWatch metric names
 */
export const METRICS = {
  CLASSIFICATION_LATENCY: 'ClassificationLatency',
  CLASSIFICATION_COUNT: 'ClassificationCount',
  RECOVERY_SUCCESS_RATE: 'RecoverySuccessRate',
  LLM_TOKENS: 'LLMTokens',
  FALSE_POSITIVE_COUNT: 'FalsePositiveCount',
  DLQ_DEPTH_REDUCTION: 'DLQDepthReduction',
  POISON_PILL_RATE: 'PoisonPillRate',
  SYSTEMIC_INCIDENT_COUNT: 'SystemicIncidentCount',
} as const;

/**
 * PII redaction patterns
 */
export const PII_PATTERNS = [
  {
    name: 'Email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    name: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN_REDACTED]',
  },
  {
    name: 'CreditCard',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[CC_REDACTED]',
  },
  {
    name: 'Phone',
    pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  {
    name: 'IPAddress',
    pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    replacement: '[IP_REDACTED]',
  },
  {
    name: 'APIKey',
    pattern: /\b[A-Za-z0-9_-]{32,}\b/g,
    replacement: '[API_KEY_REDACTED]',
  },
] as const;

/**
 * Message size limits
 */
export const MESSAGE_LIMITS = {
  /** Max payload size to include in prompt (characters) */
  MAX_PAYLOAD_SIZE: 500,
  /** Max error message size (characters) */
  MAX_ERROR_MESSAGE_SIZE: 1000,
  /** Max stack trace frames */
  MAX_STACK_FRAMES: 3,
} as const;

/**
 * SQS configuration
 */
export const SQS_CONFIG = {
  /** Batch size for receiving messages */
  BATCH_SIZE: 10,
  /** Long polling wait time (seconds) */
  WAIT_TIME_SECONDS: 5,
  /** Message visibility timeout (seconds) */
  VISIBILITY_TIMEOUT_SECONDS: 300, // 5 minutes
} as const;
