/**
 * Anthropic Claude API client wrapper
 * Handles LLM classification requests with error handling and retries
 */

import Anthropic from '@anthropic-ai/sdk';
import type { EnrichedDLQMessage, FailureCategory } from '@queuemint/shared';

import { buildUserPrompt, SYSTEM_PROMPT } from './prompts';
import type { LLMClassificationResponse } from './types';

// Environment variables
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] || '';
const LLM_MODEL = process.env['LLM_MODEL'] || 'claude-sonnet-4-5-20250929';
const LLM_MAX_TOKENS = parseInt(process.env['LLM_MAX_TOKENS'] || '1024', 10);
const LLM_TEMPERATURE = parseFloat(process.env['LLM_TEMPERATURE'] || '0.2');

/**
 * LLM client for failure classification
 */
export class LLMClient {
  private client: Anthropic;
  
  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || ANTHROPIC_API_KEY,
    });
  }
  
  /**
   * Classify failure using Claude API
   * Returns classification category, confidence, and reasoning
   */
  async classifyFailure(
    message: EnrichedDLQMessage
  ): Promise<{
    classification: LLMClassificationResponse;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }> {
    const startTime = Date.now();
    
    try {
      // Build user prompt from enriched message
      const userPrompt = buildUserPrompt(message);
      
      // Call Claude API
      const response = await this.client.messages.create({
        model: LLM_MODEL,
        max_tokens: LLM_MAX_TOKENS,
        temperature: LLM_TEMPERATURE,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });
      
      // Extract text from response
      const content = response.content[0];
      if (!content || content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }
      
      // Parse JSON response
      const classification = this.parseClassificationResponse(content.text);
      
      // Validate response
      this.validateClassification(classification);
      
      const latencyMs = Date.now() - startTime;
      
      return {
        classification,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      console.error('LLM classification error', {
        messageId: message.messageId,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        latencyMs,
      });
      
      // Fallback to conservative classification
      throw error;
    }
  }
  
  /**
   * Parse Claude API response text as JSON
   */
  private parseClassificationResponse(text: string): LLMClassificationResponse {
    try {
      // Extract JSON from response (may have markdown code fences)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        category: parsed.category,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      throw new Error(
        `Failed to parse LLM response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Validate classification response
   */
  private validateClassification(classification: LLMClassificationResponse): void {
    const validCategories: FailureCategory[] = ['TRANSIENT', 'POISON_PILL', 'SYSTEMIC'];
    
    if (!validCategories.includes(classification.category)) {
      throw new Error(`Invalid category: ${classification.category}`);
    }
    
    if (
      typeof classification.confidence !== 'number' ||
      classification.confidence < 0 ||
      classification.confidence > 1
    ) {
      throw new Error(`Invalid confidence: ${classification.confidence}`);
    }
    
    if (!classification.reasoning || classification.reasoning.trim().length === 0) {
      throw new Error('Missing reasoning');
    }
  }
}

/**
 * Create LLM client instance
 */
export function createLLMClient(apiKey?: string): LLMClient {
  return new LLMClient(apiKey);
}
