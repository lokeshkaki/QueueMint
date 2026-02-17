/**
 * Local type definitions for Failure Analyzer
 */

import type { ClassificationResult, EnrichedDLQMessage, FailureCategory } from '@queuemint/shared';

/**
 * LLM classification result from Claude API
 */
export interface LLMClassificationResponse {
  /** Classification category */
  category: FailureCategory;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** LLM reasoning explanation */
  reasoning: string;
}

/**
 * Semantic cache entry
 */
export interface SemanticCacheEntry {
  /** Semantic hash key */
  semanticHash: string;
  /** Cached classification result */
  classification: ClassificationResult;
  /** Cache entry timestamp (Unix epoch ms) */
  cachedAt: number;
  /** TTL for auto-deletion (1 hour) */
  ttl: number;
}

/**
 * Classification context for decision making
 */
export interface ClassificationContext {
  /** Enriched DLQ message */
  message: EnrichedDLQMessage;
  /** Semantic hash for caching */
  semanticHash: string;
  /** Current timestamp */
  timestamp: number;
}

/**
 * Heuristic classification result
 */
export interface HeuristicResult {
  /** Whether heuristic matched */
  matched: boolean;
  /** Classification category (if matched) */
  category?: FailureCategory;
  /** Confidence score (if matched) */
  confidence?: number;
  /** Rule that matched */
  ruleName?: string;
  /** Rule description */
  description?: string;
}
