import type { ClassificationResult, EnrichedDLQMessage } from '@queuemint/shared';
import type { EventBridgeEvent } from 'aws-lambda';

interface ClassifiedMessageEvent {
  message: EnrichedDLQMessage;
  classification: ClassificationResult;
}

/**
 * Action Executors - Entry point for all recovery actions
 * Routes to appropriate handler based on classification
 * 
 * Triggered by: EventBridge event from Failure Analyzer
 */
export async function handler(
  event: EventBridgeEvent<'MessageClassified', ClassifiedMessageEvent>
): Promise<void> {
  const { message, classification } = event.detail;
  console.log('Action Executor triggered', {
    messageId: message.messageId,
    category: classification.category,
  });
  
  // TODO: Implement in Week 2, Days 11-12
  // Route based on classification.category:
  // - TRANSIENT -> transient-handler.ts (retry with backoff)
  // - POISON_PILL -> poison-pill-handler.ts (archive to S3)
  // - SYSTEMIC -> systemic-handler.ts (PagerDuty escalation)
  
  throw new Error('Not implemented');
}
