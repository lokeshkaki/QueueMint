/**
 * Systemic failure handler
 * Creates PagerDuty incident for human intervention
 */

import { PAGERDUTY_INTEGRATION_KEY, PAGERDUTY_SEVERITIES } from './constants';
import type { ActionContext, ActionResult } from './types';

/**
 * PagerDuty Event API v2 request body
 */
interface PagerDutyEvent {
  routing_key: string;
  event_action: 'trigger';
  payload: {
    summary: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    source: string;
    custom_details: Record<string, unknown>;
  };
  dedup_key?: string;
  client?: string;
  client_url?: string;
}

/**
 * PagerDuty Event API v2 response
 */
interface PagerDutyResponse {
  status: string;
  message: string;
  dedup_key: string;
}

/**
 * Send event to PagerDuty Events API v2
 */
async function sendPagerDutyEvent(event: PagerDutyEvent): Promise<PagerDutyResponse> {
  const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PagerDuty API error ${response.status}: ${errorText}`);
  }
  
  return (await response.json()) as PagerDutyResponse;
}

/**
 * Map escalation severity to PagerDuty severity
 */
function mapSeverity(severity?: 'P1' | 'P2' | 'P3'): 'critical' | 'error' | 'warning' {
  if (!severity) return 'error';
  return PAGERDUTY_SEVERITIES[severity];
}

/**
 * Handle systemic failure - create PagerDuty incident
 */
export async function handleSystemicFailure(
  context: ActionContext
): Promise<ActionResult> {
  const { message, classification } = context;
  const startTime = Date.now();
  
  try {
    console.log('Creating PagerDuty incident for systemic failure', {
      messageId: message.messageId,
      sourceQueue: message.sourceQueue,
      similarFailures: message.enrichment.similarFailuresLast1h,
    });
    
    const severity = mapSeverity(classification.recommendedAction.escalationSeverity);
    
    // Create PagerDuty event
    const event: PagerDutyEvent = {
      routing_key: PAGERDUTY_INTEGRATION_KEY,
      event_action: 'trigger',
      payload: {
        summary: `[QueueMint] Systemic failure detected in ${message.sourceQueue}`,
        severity,
        source: `queuemint-dlq-${message.sourceQueue}`,
        custom_details: {
          message_id: message.messageId,
          source_queue: message.sourceQueue,
          error_type: message.enrichment.errorPattern.errorType,
          error_message: message.enrichment.errorPattern.errorMessage,
          similar_failures_last_hour: message.enrichment.similarFailuresLast1h,
          recent_deployments: message.enrichment.recentDeployments,
          retry_count: message.enrichment.retryCount,
          classification: {
            category: classification.category,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
          },
          recommended_action: classification.recommendedAction,
        },
      },
      dedup_key: `queuemint-systemic-${message.sourceQueue}-${message.enrichment.errorPattern.errorType}`,
      client: 'QueueMint Self-Healing DLQ',
    };
    
    const response = await sendPagerDutyEvent(event);
    
    console.log('PagerDuty incident created successfully', {
      messageId: message.messageId,
      dedupKey: response.dedup_key,
      severity,
      latencyMs: Date.now() - startTime,
    });
    
    return {
      success: true,
      action: 'ESCALATE',
      messageId: message.messageId,
      details: {
        pagerDutyIncidentId: response.dedup_key,
      },
    };
  } catch (error) {
    console.error('Failed to create PagerDuty incident', {
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    });
    
    return {
      success: false,
      action: 'ESCALATE',
      messageId: message.messageId,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
