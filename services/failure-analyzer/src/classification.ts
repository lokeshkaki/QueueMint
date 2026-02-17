/**
 * Failure classification logic
 * Combines heuristic rules with LLM classification
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  ClassificationResult,
  EnrichedDLQMessage,
  FailureCategory,
} from '@queuemint/shared';
import { matchErrorPattern } from '@queuemint/shared';

import { createLLMClient, LLMClient } from './llm-client';
import { generateSemanticHash } from './semantic-hash';
import type { HeuristicResult } from './types';

// Environment variables
const FAILURE_ANALYSIS_TABLE = process.env.FAILURE_ANALYSIS_TABLE || '';
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85');
const CACHE_TTL_HOURS = parseInt(process.env.CACHE_TTL_HOURS || '1', 10);
const SYSTEMIC_THRESHOLD = parseInt(process.env.SYSTEMIC_THRESHOLD || '10', 10);

// DynamoDB client (singleton)
let ddbDocClient: DynamoDBDocumentClient;

function getDynamoDBClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({});
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

/**
 * Classifier class - handles classification pipeline
 */
export class FailureClassifier {
  private llmClient: LLMClient;
  private ddbClient: DynamoDBDocumentClient;
  
  constructor(llmClient?: LLMClient, ddbClient?: DynamoDBDocumentClient) {
    this.llmClient = llmClient || createLLMClient();
    this.ddbClient = ddbClient || getDynamoDBClient();
  }
  
  /**
   * Classify failure using cache → heuristics → LLM pipeline
   */
  async classify(message: EnrichedDLQMessage): Promise<ClassificationResult> {
    const startTime = Date.now();
    const semanticHash = generateSemanticHash(message.enrichment.errorPattern);
    
    console.log('Starting classification', {
      messageId: message.messageId,
      semanticHash,
      errorType: message.enrichment.errorPattern.errorType,
    });
    
    // Step 1: Check semantic hash cache
    const cachedResult = await this.checkCache(semanticHash);
    if (cachedResult) {
      console.log('Cache hit', {
        messageId: message.messageId,
        semanticHash,
        category: cachedResult.category,
      });
      
      return {
        ...cachedResult,
        metadata: {
          ...cachedResult.metadata,
          cacheHit: true,
          latencyMs: Date.now() - startTime,
        },
      };
    }
    
    // Step 2: Try heuristic classification (fast-path)
    const heuristicResult = this.applyHeuristics(message);
    if (heuristicResult.matched && heuristicResult.confidence! >= CONFIDENCE_THRESHOLD) {
      console.log('Heuristic match', {
        messageId: message.messageId,
        ruleName: heuristicResult.ruleName,
        category: heuristicResult.category,
        confidence: heuristicResult.confidence,
      });
      
      const result: ClassificationResult = {
        category: heuristicResult.category!,
        confidence: heuristicResult.confidence!,
        reasoning: `Heuristic rule: ${heuristicResult.description}`,
        recommendedAction: this.getRecommendedAction(
          heuristicResult.category!,
          message.enrichment.retryCount
        ),
        metadata: {
          llmModel: 'heuristic',
          tokens: { input: 0, output: 0 },
          latencyMs: Date.now() - startTime,
          cacheHit: false,
        },
      };
      
      // Cache heuristic result
      await this.cacheResult(semanticHash, result);
      
      return result;
    }
    
    // Step 3: Use LLM for ambiguous cases
    console.log('Using LLM classification', {
      messageId: message.messageId,
      semanticHash,
    });
    
    try {
      const llmResult = await this.llmClient.classifyFailure(message);
      
      const result: ClassificationResult = {
        category: llmResult.classification.category,
        confidence: llmResult.classification.confidence,
        reasoning: llmResult.classification.reasoning,
        recommendedAction: this.getRecommendedAction(
          llmResult.classification.category,
          message.enrichment.retryCount
        ),
        metadata: {
          llmModel: process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929',
          tokens: {
            input: llmResult.inputTokens,
            output: llmResult.outputTokens,
          },
          latencyMs: llmResult.latencyMs,
          cacheHit: false,
        },
      };
      
      // Cache LLM result
      await this.cacheResult(semanticHash, result);
      
      console.log('LLM classification complete', {
        messageId: message.messageId,
        category: result.category,
        confidence: result.confidence,
        tokens: result.metadata.tokens.input + result.metadata.tokens.output,
      });
      
      return result;
    } catch (error) {
      console.error('LLM classification failed, using conservative fallback', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Conservative fallback: classify as SYSTEMIC for human review
      return {
        category: 'SYSTEMIC',
        confidence: 0.6,
        reasoning: 'LLM classification failed, requires human review',
        recommendedAction: this.getRecommendedAction('SYSTEMIC', message.enrichment.retryCount),
        metadata: {
          llmModel: 'fallback',
          tokens: { input: 0, output: 0 },
          latencyMs: Date.now() - startTime,
          cacheHit: false,
        },
      };
    }
  }
  
  /**
   * Apply heuristic rules for fast-path classification
   */
  private applyHeuristics(message: EnrichedDLQMessage): HeuristicResult {
    const { errorMessage } = message.enrichment.errorPattern;
    const { similarFailuresLast1h, recentDeployments } = message.enrichment;
    
    // Check for systemic issues first (spike + deployment correlation)
    if (
      similarFailuresLast1h >= SYSTEMIC_THRESHOLD &&
      recentDeployments.length > 0
    ) {
      return {
        matched: true,
        category: 'SYSTEMIC',
        confidence: 0.92,
        ruleName: 'Deployment Correlation',
        description: `${similarFailuresLast1h} similar failures after recent deployment`,
      };
    }
    
    // Match against known error patterns
    const patternMatch = matchErrorPattern(errorMessage);
    if (patternMatch) {
      return {
        matched: true,
        category: patternMatch.category,
        confidence: patternMatch.confidence,
        ruleName: patternMatch.name,
        description: patternMatch.description,
      };
    }
    
    // No heuristic match
    return { matched: false };
  }
  
  /**
   * Check semantic hash cache in DynamoDB
   */
  private async checkCache(semanticHash: string): Promise<ClassificationResult | null> {
    try {
      const result = await this.ddbClient.send(
        new GetCommand({
          TableName: FAILURE_ANALYSIS_TABLE,
          Key: { messageId: `cache#${semanticHash}` },
          ProjectionExpression: 'classification, confidence, reasoning, recommendedAction, metadata',
        })
      );
      
      if (!result.Item) {
        return null;
      }
      
      // Check if cache entry is still valid (within TTL)
      const cachedAt = result.Item.metadata?.cachedAt || 0;
      const now = Date.now();
      const cacheAgeHours = (now - cachedAt) / (1000 * 60 * 60);
      
      if (cacheAgeHours > CACHE_TTL_HOURS) {
        return null; // Cache expired
      }
      
      return result.Item as ClassificationResult;
    } catch (error) {
      console.error('Cache check failed', {
        semanticHash,
        error: error instanceof Error ? error.message : String(error),
      });
      return null; // Fail open - proceed without cache
    }
  }
  
  /**
   * Cache classification result in DynamoDB
   */
  private async cacheResult(
    semanticHash: string,
    result: ClassificationResult
  ): Promise<void> {
    try {
      const now = Date.now();
      const ttl = Math.floor(now / 1000) + CACHE_TTL_HOURS * 60 * 60;
      
      await this.ddbClient.send(
        new PutCommand({
          TableName: FAILURE_ANALYSIS_TABLE,
          Item: {
            messageId: `cache#${semanticHash}`,
            semanticHash,
            ...result,
            metadata: {
              ...result.metadata,
              cachedAt: now,
            },
            ttl,
          },
        })
      );
    } catch (error) {
      console.error('Cache write failed', {
        semanticHash,
        error: error instanceof Error ? error.message : String(error),
      });
      // Non-fatal - continue without caching
    }
  }
  
  /**
   * Get recommended action based on classification
   */
  private getRecommendedAction(
    category: FailureCategory,
    retryCount: number
  ): ClassificationResult['recommendedAction'] {
    switch (category) {
      case 'TRANSIENT':
        return {
          action: 'REPLAY',
          retryDelaySeconds: Math.min(30 * Math.pow(2, retryCount), 900), // Exponential backoff, max 15min
          maxRetries: 3,
          humanReviewRequired: false,
        };
      
      case 'POISON_PILL':
        return {
          action: 'ARCHIVE',
          humanReviewRequired: true,
        };
      
      case 'SYSTEMIC':
        return {
          action: 'ESCALATE',
          escalationSeverity: 'P1',
          humanReviewRequired: true,
        };
      
      default:
        // Should never reach here
        return {
          action: 'ESCALATE',
          escalationSeverity: 'P2',
          humanReviewRequired: true,
        };
    }
  }
}

/**
 * Create classifier instance
 */
export function createClassifier(
  llmClient?: LLMClient,
  ddbClient?: DynamoDBDocumentClient
): FailureClassifier {
  return new FailureClassifier(llmClient, ddbClient);
}
