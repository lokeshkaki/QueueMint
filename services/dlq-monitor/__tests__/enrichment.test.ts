/**
 * Unit tests for message enrichment
 */

import type { Message } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

import { enrichMessage, extractErrorPattern } from '../src/enrichment';

const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('Message Enrichment', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('enrichMessage', () => {
    it('should enrich message with all metadata', async () => {
      const message: Message = {
        MessageId: 'msg-enrich-test',
        ReceiptHandle: 'receipt-handle',
        Body: JSON.stringify({
          error: {
            name: 'NetworkError',
            message: 'ECONNREFUSED: Connection refused',
            stack: 'Error: ECONNREFUSED\n    at TCPConnectWrap.afterConnect',
            code: 'ECONNREFUSED',
          },
        }),
        Attributes: {
          ApproximateReceiveCount: '2',
          SentTimestamp: String(Date.now()),
          ApproximateFirstReceiveTimestamp: String(Date.now() - 60000),
        },
      };

      // Mock retry count lookup
      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-enrich-test',
          queueName: 'webhook-dlq',
          retryCount: 1,
        },
      });

      // Mock similar failures query
      dynamoMock.on(QueryCommand).resolves({
        Count: 5,
      });

      const enriched = await enrichMessage(message, 'https://sqs/webhook-dlq', 'webhook-dlq');

      expect(enriched).toEqual({
        messageId: 'msg-enrich-test',
        receiptHandle: 'receipt-handle',
        body: message.Body,
        attributes: expect.objectContaining({
          approximateReceiveCount: 2,
        }),
        sourceQueue: 'webhook-dlq',
        enrichment: expect.objectContaining({
          retryCount: 1,
          similarFailuresLast1h: 4, // 5 - 1 (current message)
          errorPattern: expect.objectContaining({
            errorType: 'NetworkError',
            errorMessage: 'ECONNREFUSED: Connection refused',
            errorCode: 'ECONNREFUSED',
            affectedService: 'Webhook',
          }),
        }),
      });
    });

    it('should handle message without error details', async () => {
      const message: Message = {
        MessageId: 'msg-no-error',
        ReceiptHandle: 'receipt',
        Body: 'Plain text message body',
        Attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: String(Date.now()),
          ApproximateFirstReceiveTimestamp: String(Date.now()),
        },
      };

      dynamoMock.on(GetCommand).resolves({ Item: { retryCount: 0 } });
      dynamoMock.on(QueryCommand).resolves({ Count: 0 });

      const enriched = await enrichMessage(message, 'https://sqs/test-dlq', 'test-dlq');

      expect(enriched.enrichment.errorPattern).toEqual({
        errorType: 'ParseError',
        errorMessage: 'Plain text message body',
        affectedService: 'Test',
      });
    });
  });

  describe('extractErrorPattern', () => {
    it('should extract error from standard format', async () => {
      const body = JSON.stringify({
        error: {
          name: 'ValidationError',
          message: 'Invalid email format',
          stack: 'Error: Invalid email\n    at validateEmail\n    at processRequest',
        },
      });

      const pattern = await extractErrorPattern(body, 'webhook-dlq');

      expect(pattern).toEqual({
        errorType: 'ValidationError',
        errorMessage: 'Invalid email format',
        stackTrace: expect.stringContaining('Error: Invalid email'),
        affectedService: 'Webhook',
      });
    });

    it('should extract error from AWS Lambda format', async () => {
      const body = JSON.stringify({
        errorMessage: 'Task timed out after 30.00 seconds',
        errorType: 'Task.Timeout',
        stackTrace: ['LambdaHandler.handler', 'Runtime.handleOnce'],
      });

      const pattern = await extractErrorPattern(body, 'deployment-dlq');

      expect(pattern.errorType).toBe('Task.Timeout');
      expect(pattern.errorMessage).toBe('Task timed out after 30.00 seconds');
      expect(pattern.affectedService).toBe('Deployment');
    });

    it('should infer error type from message', async () => {
      const testCases = [
        {
          body: JSON.stringify({ message: 'ETIMEDOUT: connection timeout' }),
          expectedType: 'TimeoutError',
        },
        {
          body: JSON.stringify({ message: 'ECONNREFUSED: connection refused' }),
          expectedType: 'NetworkError',
        },
        {
          body: JSON.stringify({ message: 'Validation failed: email is required' }),
          expectedType: 'ValidationError',
        },
        {
          body: JSON.stringify({ message: 'HTTP 404 Not Found' }),
          expectedType: 'HTTPError',
        },
        {
          body: JSON.stringify({ message: 'Permission denied: unauthorized access' }),
          expectedType: 'PermissionError',
        },
      ];

      for (const { body, expectedType } of testCases) {
        const pattern = await extractErrorPattern(body, 'test-dlq');
        expect(pattern.errorType).toBe(expectedType);
      }
    });

    it('should extract HTTP status codes', async () => {
      const body = JSON.stringify({
        error: 'Request failed with status code 429',
      });

      const pattern = await extractErrorPattern(body, 'api-dlq');

      expect(pattern.errorCode).toBe('429');
    });

    it('should truncate long error messages', async () => {
      const longMessage = 'Error: ' + 'a'.repeat(600);
      const body = JSON.stringify({
        error: { message: longMessage },
      });

      const pattern = await extractErrorPattern(body, 'test-dlq');

      expect(pattern.errorMessage.length).toBe(503); // 500 + '...'
      expect(pattern.errorMessage).toMatch(/\.\.\.$/);
    });

    it('should truncate stack traces to top 3 frames', async () => {
      const longStack = [
        'Error: Test error',
        '    at frame1',
        '    at frame2',
        '    at frame3',
        '    at frame4',
        '    at frame5',
      ].join('\n');

      const body = JSON.stringify({
        error: {
          message: 'Test error',
          stack: longStack,
        },
      });

      const pattern = await extractErrorPattern(body, 'test-dlq');

      expect(pattern.stackTrace).toBeDefined();
      expect(pattern.stackTrace!.split('\n').length).toBe(4); // Error message + 3 frames
    });

    it('should infer service name from queue name', async () => {
      const testCases = [
        { queueName: 'webhook-dlq', expectedService: 'Webhook' },
        { queueName: 'deployment-service-dlq', expectedService: 'DeploymentService' },
        { queueName: 'github_integration_dlq', expectedService: 'GithubIntegration' },
        { queueName: 'api-gateway-dlq', expectedService: 'ApiGateway' },
      ];

      for (const { queueName, expectedService } of testCases) {
        const body = JSON.stringify({ error: 'test' });
        const pattern = await extractErrorPattern(body, queueName);
        expect(pattern.affectedService).toBe(expectedService);
      }
    });

    it('should handle non-JSON message bodies', async () => {
      const body = 'Plain text error message';

      const pattern = await extractErrorPattern(body, 'test-dlq');

      expect(pattern.errorType).toBe('ParseError');
      expect(pattern.errorMessage).toBe('Plain text error message');
      expect(pattern.affectedService).toBe('Test');
    });

    it('should handle error as string instead of object', async () => {
      const body = JSON.stringify({
        error: 'Request failed with status code 429',
      });

      const pattern = await extractErrorPattern(body, 'api-dlq');

      expect(pattern.errorMessage).toBe('Request failed with status code 429');
      expect(pattern.errorCode).toBe('429');
    });

    it('should handle missing stackTrace', async () => {
      const body = JSON.stringify({
        error: {
          name: 'TestError',
          message: 'Test error without stack',
        },
      });

      const pattern = await extractErrorPattern(body, 'test-dlq');

      expect(pattern.stackTrace).toBeUndefined();
    });

    it('should handle empty error message', async () => {
      const body = JSON.stringify({
        error: {},
      });

      const pattern = await extractErrorPattern(body, 'test-dlq');

      expect(pattern.errorMessage).toBe('Unknown error');
    });

    it('should handle DynamoDB query errors for similar failures', async () => {
      const message: Message = {
        MessageId: 'msg-query-error',
        ReceiptHandle: 'receipt',
        Body: JSON.stringify({ error: 'test' }),
        Attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: String(Date.now()),
          ApproximateFirstReceiveTimestamp: String(Date.now()),
        },
      };

      dynamoMock.on(GetCommand).resolves({ Item: { retryCount: 0 } });
      dynamoMock.on(QueryCommand).rejects(new Error('DynamoDB query error'));

      const enriched = await enrichMessage(message, 'https://sqs/test-dlq', 'test-dlq');

      // Should default to 0 similar failures on error
      expect(enriched.enrichment.similarFailuresLast1h).toBe(0);
    });
  });
});
