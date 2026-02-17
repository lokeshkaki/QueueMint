/**
 * Failure Analyzer Lambda Handler
 * Classifies failures using heuristics + LLM (Claude)
 *
 * Triggered by: EventBridge event from DLQ Monitor
 * Outputs: Classification result stored in DynamoDB and routed to Action Executors
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { EnrichedDLQMessage, FailureAnalysisRecord } from '@queuemint/shared';
import type { EventBridgeEvent } from 'aws-lambda';

import { createClassifier } from './classification';
import { generateSemanticHash } from './semantic-hash';

// Environment variables
const FAILURE_ANALYSIS_TABLE = process.env['FAILURE_ANALYSIS_TABLE'] || '';
const EVENT_BUS_NAME = process.env['EVENT_BUS_NAME'] || '';

// AWS SDK clients (singleton)
let ddbDocClient: DynamoDBDocumentClient;
let eventBridgeClient: EventBridgeClient;

function getDynamoDBClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({});
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({});
  }
  return eventBridgeClient;
}

/**
 * Lambda handler for failure classification
 */
export async function handler(
  event: EventBridgeEvent<'DLQMessageEnriched', EnrichedDLQMessage>
): Promise<void> {
  const message = event.detail;
  const startTime = Date.now();

  console.log('Failure Analyzer triggered', {
    messageId: message.messageId,
    sourceQueue: message.sourceQueue,
    errorType: message.enrichment.errorPattern.errorType,
  });

  try {
    // Create classifier
    const classifier = createClassifier();

    // Classify failure (cache → heuristics → LLM)
    const classification = await classifier.classify(message);

    console.log('Classification complete', {
      messageId: message.messageId,
      category: classification.category,
      confidence: classification.confidence,
      action: classification.recommendedAction.action,
      cacheHit: classification.metadata.cacheHit,
      latencyMs: Date.now() - startTime,
    });

    // Store classification result in DynamoDB
    await storeClassificationResult(message, classification);

    // Route to appropriate action executor
    await routeToActionExecutor(message, classification);

    console.log('Classification stored and routed', {
      messageId: message.messageId,
      totalLatencyMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Failure analysis error', {
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    });

    throw error; // Let Lambda retry
  }
}

/**
 * Store classification result in DynamoDB
 */
async function storeClassificationResult(
  message: EnrichedDLQMessage,
  classification: any
): Promise<void> {
  const ddbClient = getDynamoDBClient();
  const semanticHash = generateSemanticHash(message.enrichment.errorPattern);

  const record: FailureAnalysisRecord = {
    messageId: message.messageId,
    timestamp: Date.now(),
    sourceQueue: message.sourceQueue,
    classification: classification.category,
    confidence: classification.confidence,
    errorMessage: message.enrichment.errorPattern.errorMessage.substring(0, 500),
    errorType: message.enrichment.errorPattern.errorType,
    errorCode: message.enrichment.errorPattern.errorCode,
    llmReasoning: classification.reasoning,
    llmModel: classification.metadata.llmModel,
    tokens: classification.metadata.tokens,
    actionTaken: mapActionToTaken(classification.recommendedAction.action),
    recoveryOutcome: 'PENDING',
    retryCount: message.enrichment.retryCount,
    retryScheduledFor:
      classification.recommendedAction.action === 'REPLAY'
        ? Date.now() + (classification.recommendedAction.retryDelaySeconds || 0) * 1000
        : undefined,
    suspectedDeployment:
      message.enrichment.recentDeployments.length > 0
        ? message.enrichment.recentDeployments[0]!.version
        : undefined,
    similarFailuresCount: message.enrichment.similarFailuresLast1h,
    semanticHash,
    ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  };

  await ddbClient.send(
    new PutCommand({
      TableName: FAILURE_ANALYSIS_TABLE,
      Item: record,
    })
  );
}

/**
 * Route classification result to appropriate action executor via EventBridge
 */
async function routeToActionExecutor(
  message: EnrichedDLQMessage,
  classification: any
): Promise<void> {
  const ebClient = getEventBridgeClient();

  // Determine detail type based on action
  const detailTypeMap: Record<string, string> = {
    REPLAY: 'TransientFailure',
    ARCHIVE: 'PoisonPillFailure',
    ESCALATE: 'SystemicFailure',
  };

  const detailType = detailTypeMap[classification.recommendedAction.action] || 'UnknownFailure';

  await ebClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'queuemint.failure-analyzer',
          DetailType: detailType,
          Detail: JSON.stringify({
            message,
            classification,
          }),
          EventBusName: EVENT_BUS_NAME,
        },
      ],
    })
  );
}

/**
 * Map recommended action to action taken enum
 */
function mapActionToTaken(action: string): 'REPLAYED' | 'ARCHIVED' | 'ESCALATED' {
  const mapping: Record<string, 'REPLAYED' | 'ARCHIVED' | 'ESCALATED'> = {
    REPLAY: 'REPLAYED',
    ARCHIVE: 'ARCHIVED',
    ESCALATE: 'ESCALATED',
  };
  return mapping[action] || 'ESCALATED';
}
