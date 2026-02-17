/**
 * Semantic hash generation for caching classification results
 * Generates stable hash from error pattern components
 */

import crypto from 'crypto';

import type { ErrorPattern } from '@queuemint/shared';

/**
 * Generate semantic hash from error pattern
 * Used to cache classification results for similar errors
 * 
 * Hash includes:
 * - Error type (normalized)
 * - Error code (if present)
 * - First line of error message (normalized)
 * - Affected service
 * 
 * Excludes:
 * - Specific timestamps, IDs, dynamic values
 * - Stack traces (too specific)
 * - Full message bodies
 */
export function generateSemanticHash(errorPattern: ErrorPattern): string {
  // Normalize error type (lowercase, remove whitespace)
  const normalizedType = errorPattern.errorType.toLowerCase().trim();
  
  // Normalize error code (uppercase, remove whitespace)
  const normalizedCode = errorPattern.errorCode
    ? errorPattern.errorCode.toUpperCase().trim()
    : '';
  
  // Extract first line of error message and normalize
  const lines = errorPattern.errorMessage.split('\n');
  const firstLine = (lines[0] || errorPattern.errorMessage)
    .toLowerCase()
    .trim();
  
  // Normalize by removing dynamic values (numbers, IDs, timestamps)
  const normalizedMessage = normalizeDynamicValues(firstLine);
  
  // Normalize service name
  const normalizedService = errorPattern.affectedService.toLowerCase().trim();
  
  // Combine components
  const components = [
    normalizedType,
    normalizedCode,
    normalizedMessage,
    normalizedService,
  ].filter(Boolean); // Remove empty strings
  
  const combined = components.join('|');
  
  // Generate SHA-256 hash
  return crypto
    .createHash('sha256')
    .update(combined)
    .digest('hex')
    .substring(0, 16); // Use first 16 chars for brevity
}

/**
 * Normalize dynamic values in error messages
 * Replaces specific values with placeholders for better caching
 * 
 * Examples:
 * - "timeout after 5000ms" -> "timeout after Xms"
 * - "user id 12345 not found" -> "user id X not found"
 * - "2024-02-16T10:30:45Z" -> "X"
 */
function normalizeDynamicValues(message: string): string {
  let normalized = message;
  
  // Replace UUIDs first (before number replacement)
  normalized = normalized.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    'X'
  );
  
  // Replace ISO timestamps (case-insensitive for T and Z)
  normalized = normalized.replace(
    /\d{4}-\d{2}-\d{2}[tT]\d{2}:\d{2}:\d{2}(\.\d{3})?[zZ]?/g,
    'X'
  );
  
  // Replace numbers (but preserve error codes like "429", "503")
  // Match numbers followed by units (ms, kb, mb, etc.)
  normalized = normalized.replace(/\d+(\.\d+)?(ms|kb|mb|gb|s|sec)/gi, 'X$2');
  
  // Replace standalone numbers (3+ digits)
  normalized = normalized.replace(/\b\d{3,}\b/g, 'X');
  
  // Replace hex IDs (8+ chars)
  normalized = normalized.replace(/\b[0-9a-f]{8,}\b/gi, 'X');
  
  // Collapse multiple Xs into one
  normalized = normalized.replace(/X+/g, 'X');
  
  // Trim whitespace
  normalized = normalized.trim();
  
  return normalized;
}
