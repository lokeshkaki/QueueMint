/**
 * Type definitions for action executors
 */

import type { EnrichedDLQMessage, ClassificationResult } from '@queuemint/shared';

/**
 * Context passed to all action handlers
 */
export interface ActionContext {
  message: EnrichedDLQMessage;
  classification: ClassificationResult;
}

/**
 * Result from executing an action
 */
export interface ActionResult {
  success: boolean;
  action: string;
  messageId: string;
  details?: {
    s3Key?: string;
    pagerDutyIncidentId?: string;
    replayDelaySeconds?: number;
    targetQueue?: string;
    error?: string;
  };
}
