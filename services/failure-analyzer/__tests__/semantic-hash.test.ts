/**
 * Unit tests for semantic hash module
 */

import type { ErrorPattern } from '@queuemint/shared';

import { generateSemanticHash } from '../src/semantic-hash';

describe('generateSemanticHash', () => {
  const baseErrorPattern: ErrorPattern = {
    errorType: 'NetworkError',
    errorMessage: 'ETIMEDOUT: connection timeout after 5000ms',
    stackTrace: 'at handler (index.js:10)',
    errorCode: 'ETIMEDOUT',
    affectedService: 'webhook-service',
  };

  it('should generate consistent hash for same error pattern', () => {
    const hash1 = generateSemanticHash(baseErrorPattern);
    const hash2 = generateSemanticHash(baseErrorPattern);
    expect(hash1).toBe(hash2);
  });

  it('should generate same hash when only dynamic values change', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorMessage: 'ETIMEDOUT: connection timeout after 5000ms',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorMessage: 'ETIMEDOUT: connection timeout after 8000ms',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).toBe(hash2); // Should be same after normalization
  });

  it('should generate same hash when numbers change', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorMessage: 'User ID 12345 not found',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorMessage: 'User ID 67890 not found',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).toBe(hash2);
  });

  it('should generate same hash when UUIDs change', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorMessage: 'Request 550e8400-e29b-41d4-a716-446655440000 failed',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorMessage: 'Request 6ba7b810-9dad-11d1-80b4-00c04fd430c8 failed',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).toBe(hash2);
  });

  it('should generate same hash when timestamps change', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorMessage: 'Error at 2024-02-16T10:30:45Z',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorMessage: 'Error at 2024-02-17T11:45:30Z',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).toBe(hash2);
  });

  it('should generate different hash for different error types', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorType: 'NetworkError',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorType: 'ValidationError',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hash for different error codes', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorCode: 'ETIMEDOUT',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorCode: 'ECONNREFUSED',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hash for different error messages', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorMessage: 'Connection timeout',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorMessage: 'Connection refused',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hash for different services', () => {
    const pattern1 = {
      ...baseErrorPattern,
      affectedService: 'webhook-service',
    };
    const pattern2 = {
      ...baseErrorPattern,
      affectedService: 'payment-service',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).not.toBe(hash2);
  });

  it('should be case-insensitive for error type and service', () => {
    const pattern1 = {
      ...baseErrorPattern,
      errorType: 'NetworkError',
      affectedService: 'webhook-service',
    };
    const pattern2 = {
      ...baseErrorPattern,
      errorType: 'NETWORKERROR',
      affectedService: 'WEBHOOK-SERVICE',
    };
    
    const hash1 = generateSemanticHash(pattern1);
    const hash2 = generateSemanticHash(pattern2);
    expect(hash1).toBe(hash2);
  });

  it('should return 16-character hex string', () => {
    const hash = generateSemanticHash(baseErrorPattern);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
