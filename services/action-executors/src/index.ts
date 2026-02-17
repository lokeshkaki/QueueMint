import type { ClassificationResult, EnrichedDLQMessage } from '@queuemint/shared';
import type { EventBridgeEvent } from 'aws-lambda';

import { handlePoisonPill } from './poison-pill-handler';
import { handleSystemicFailure } from './systemic-handler';
import { handleTransientFailure } from './transient-handler';
import type { ActionContext } from './types';

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
  const startTime = Date.now();
  
  console.log('Action Executor triggered', {
    messageId: message.messageId,
    sourceQueue: message.sourceQueue,
    category: classification.category,
    action: classification.recommendedAction.action,
  });
  
  try {
    const context: ActionContext = { message, classification };
    
    // Route to appropriate handler based on classification category
    let result;
    switch (classification.category) {
      case 'TRANSIENT':
        result = await handleTransientFailure(context);
        break;
      
      case 'POISON_PILL':
        result = await handlePoisonPill(context);
        break;
      
      case 'SYSTEMIC':
        result = await handleSystemicFailure(context);
        break;
      
      default:
        throw new Error(`Unknown classification category: ${classification.category}`);
    }
    
    if (result.success) {
      console.log('Action executed successfully', {
        messageId: message.messageId,
        action: result.action,
        details: result.details,
        totalLatencyMs: Date.now() - startTime,
      });
    } else {
      console.error('Action execution failed', {
        messageId: message.messageId,
        action: result.action,
        error: result.details?.error,
        totalLatencyMs: Date.now() - startTime,
      });
      
      // Throw error to trigger Lambda retry
      throw new Error(`Action execution failed: ${result.details?.error}`);
    }
  } catch (error) {
    console.error('Action executor error', {
      messageId: message.messageId,
      category: classification.category,
      error: error instanceof Error ? error.message : String(error),
      totalLatencyMs: Date.now() - startTime,
    });
    
    // Re-throw to trigger Lambda retry
    throw error;
  }
}
