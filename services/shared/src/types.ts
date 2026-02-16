/**
 * Core TypeScript interfaces for QueueMint Self-Healing DLQ System
 */

/**
 * Enriched DLQ message with contextual metadata
 */
export interface EnrichedDLQMessage {
  /** SQS Message ID */
  messageId: string;
  /** SQS receipt handle for deletion */
  receiptHandle: string;
  /** Original message body */
  body: string;
  /** SQS message attributes */
  attributes: MessageAttributes;
  /** Source DLQ name (e.g., 'webhook-dlq') */
  sourceQueue: string;
  /** Enrichment data from various sources */
  enrichment: MessageEnrichment;
}

export interface MessageAttributes {
  /** Number of times message was received */
  approximateReceiveCount: number;
  /** When message was sent (Unix epoch ms) */
  sentTimestamp: number;
  /** When message first entered DLQ (Unix epoch ms) */
  approximateFirstReceiveTimestamp: number;
}

export interface MessageEnrichment {
  /** Number of previous retry attempts */
  retryCount: number;
  /** When message was first seen (Unix epoch ms) */
  firstSeenAt: number;
  /** When message last failed (Unix epoch ms) */
  lastFailedAt: number;
  /** Count of similar failures in last hour */
  similarFailuresLast1h: number;
  /** Recent deployments (last 15 minutes) */
  recentDeployments: DeploymentEvent[];
  /** Extracted error pattern */
  errorPattern: ErrorPattern;
}

export interface ErrorPattern {
  /** Error type (e.g., 'NetworkError', 'ValidationError') */
  errorType: string;
  /** Error message (truncated to 500 chars) */
  errorMessage: string;
  /** Stack trace (top 3 frames) */
  stackTrace?: string;
  /** HTTP status code or AWS error code */
  errorCode?: string;
  /** Service where error occurred */
  affectedService: string;
}

export interface DeploymentEvent {
  /** Unique deployment ID */
  deploymentId: string;
  /** Deployment version or tag */
  version: string;
  /** When deployed (Unix epoch ms) */
  deployedAt: number;
  /** GitHub user who committed */
  committedBy: string;
  /** GitHub PR or commit diff URL */
  diff_url: string;
}

/**
 * Classification result from failure analyzer
 */
export interface ClassificationResult {
  /** Failure category */
  category: FailureCategory;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** LLM or heuristic reasoning */
  reasoning: string;
  /** Recommended recovery action */
  recommendedAction: RecommendedAction;
  /** Classification metadata */
  metadata: ClassificationMetadata;
}

export type FailureCategory = 'TRANSIENT' | 'POISON_PILL' | 'SYSTEMIC';

export interface RecommendedAction {
  /** Action to take */
  action: 'REPLAY' | 'ARCHIVE' | 'ESCALATE';
  /** Delay before retry (seconds) */
  retryDelaySeconds?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** PagerDuty severity */
  escalationSeverity?: 'P1' | 'P2' | 'P3';
  /** Whether human review is required */
  humanReviewRequired: boolean;
}

export interface ClassificationMetadata {
  /** LLM model used or 'heuristic' */
  llmModel: string;
  /** Token usage */
  tokens: {
    input: number;
    output: number;
  };
  /** Classification latency (ms) */
  latencyMs: number;
  /** Whether result was from cache */
  cacheHit: boolean;
}

/**
 * Recovery outcome tracking
 */
export interface RecoveryOutcome {
  /** Original message ID */
  messageId: string;
  /** Classification used */
  classification: FailureCategory;
  /** Action taken */
  actionTaken: 'REPLAYED' | 'ARCHIVED' | 'ESCALATED';
  /** Outcome status */
  recoveryOutcome: 'SUCCESS' | 'FAILED' | 'PENDING';
  /** Retry attempt number */
  retryAttempt: number;
  /** When outcome was recorded (Unix epoch ms) */
  timestamp: number;
  /** Optional error message if failed */
  errorMessage?: string;
}

/**
 * DynamoDB record structure
 */
export interface FailureAnalysisRecord {
  /** Partition key: SQS Message ID */
  messageId: string;
  /** Unix epoch ms */
  timestamp: number;
  /** Source DLQ name */
  sourceQueue: string;
  /** Classification category */
  classification: FailureCategory;
  /** Confidence score */
  confidence: number;
  /** Truncated error message */
  errorMessage: string;
  /** Error type */
  errorType: string;
  /** Error code */
  errorCode?: string;
  /** LLM reasoning */
  llmReasoning: string;
  /** LLM model used */
  llmModel: string;
  /** Token usage */
  tokens: {
    input: number;
    output: number;
  };
  /** Action taken */
  actionTaken: 'REPLAYED' | 'ARCHIVED' | 'ESCALATED';
  /** Recovery outcome */
  recoveryOutcome: 'SUCCESS' | 'FAILED' | 'PENDING';
  /** Retry count */
  retryCount: number;
  /** When retry is scheduled (Unix epoch ms) */
  retryScheduledFor?: number;
  /** S3 archive key */
  s3ArchiveKey?: string;
  /** PagerDuty incident ID */
  pagerdutyIncidentId?: string;
  /** Suspected deployment version */
  suspectedDeployment?: string;
  /** Similar failures count */
  similarFailuresCount: number;
  /** Semantic hash for caching */
  semanticHash: string;
  /** TTL for auto-deletion (30 days) */
  ttl: number;
}

/**
 * Structured log format
 */
export interface StructuredLog {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  /** Service name */
  service: 'dlq-monitor' | 'failure-analyzer' | 'action-executor';
  /** Operation being performed */
  operation: string;
  /** Message ID being processed */
  messageId: string;
  /** Source queue */
  sourceQueue?: string;
  /** Classification info */
  classification?: {
    category: string;
    confidence: number;
    model: string;
  };
  /** Operation latency (ms) */
  latency_ms?: number;
  /** Error details */
  error?: {
    message: string;
    code: string;
    stack?: string;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Feature flags from SSM Parameter Store
 */
export interface FeatureFlags {
  /** Enable automatic replay of transient failures */
  autoReplayEnabled: boolean;
  /** Enable LLM classification (fallback to heuristics if false) */
  llmClassificationEnabled: boolean;
  /** Enable PagerDuty incident creation */
  pagerdutyIntegrationEnabled: boolean;
  /** Confidence threshold for auto-replay (0.0-1.0) */
  confidenceThreshold: number;
  /** Maximum retry attempts */
  maxRetries: number;
}

/**
 * CloudWatch metrics
 */
export interface CloudWatchMetric {
  /** Metric namespace */
  namespace: string;
  /** Metric name */
  metricName: string;
  /** Metric value */
  value: number;
  /** Metric unit */
  unit: 'Count' | 'Milliseconds' | 'Percent' | 'Seconds';
  /** Metric dimensions */
  dimensions: Array<{
    name: string;
    value: string;
  }>;
  /** Timestamp (Unix epoch ms) */
  timestamp: number;
}
