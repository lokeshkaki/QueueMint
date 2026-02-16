/**
 * Unit tests for message deduplication
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { checkAndRecordMessage, getRetryCount } from '../src/deduplication';

const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('Message Deduplication', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkAndRecordMessage', () => {
    it('should record new message and return isDuplicate=false', async () => {
      dynamoMock.on(GetCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      const result = await checkAndRecordMessage('msg-new', 'webhook-dlq');

      expect(result).toEqual({
        isDuplicate: false,
        retryCount: 0,
      });

      // Verify DynamoDB interactions
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(1);

      const putCall = dynamoMock.commandCalls(PutCommand)[0];
      expect(putCall?.args[0]?.input.Item).toMatchObject({
        messageId: 'msg-new',
        queueName: 'webhook-dlq',
        retryCount: 0,
      });
    });

    it('should detect duplicate and increment retry count', async () => {
      const firstSeenAt = Date.now() - 300000; // 5 minutes ago

      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-duplicate',
          queueName: 'webhook-dlq',
          firstSeenAt,
          lastSeenAt: Date.now() - 60000,
          retryCount: 1,
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      });

      dynamoMock.on(PutCommand).resolves({});

      const result = await checkAndRecordMessage('msg-duplicate', 'webhook-dlq');

      expect(result).toEqual({
        isDuplicate: true,
        firstSeenAt,
        retryCount: 2, // Incremented from 1
      });

      // Verify retry count was incremented
      const putCall = dynamoMock.commandCalls(PutCommand)[0];
      expect(putCall?.args[0]?.input.Item?.retryCount).toBe(2);
    });

    it('should handle multiple retries correctly', async () => {
      const firstSeenAt = Date.now() - 3600000; // 1 hour ago

      // Simulate message seen 3 times already
      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-multiple-retries',
          queueName: 'deployment-dlq',
          firstSeenAt,
          lastSeenAt: Date.now() - 600000,
          retryCount: 3,
        },
      });

      dynamoMock.on(PutCommand).resolves({});

      const result = await checkAndRecordMessage('msg-multiple-retries', 'deployment-dlq');

      expect(result).toEqual({
        isDuplicate: true,
        firstSeenAt,
        retryCount: 4,
      });
    });

    it('should set TTL for 7 days', async () => {
      dynamoMock.on(GetCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      const beforeTimestamp = Math.floor(Date.now() / 1000) + 86400 * 7;

      await checkAndRecordMessage('msg-ttl-test', 'test-dlq');

      const putCall = dynamoMock.commandCalls(PutCommand)[0];
      const ttl = putCall?.args[0]?.input.Item?.ttl as number;

      // TTL should be approximately 7 days from now (allow 1 second variance)
      expect(ttl).toBeGreaterThanOrEqual(beforeTimestamp - 1);
      expect(ttl).toBeLessThanOrEqual(beforeTimestamp + 1);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      dynamoMock.on(GetCommand).rejects(new Error('DynamoDB unavailable'));

      const result = await checkAndRecordMessage('msg-error', 'test-dlq');

      // Should return not duplicate to avoid message loss
      expect(result).toEqual({
        isDuplicate: false,
        retryCount: 0,
      });
    });

    it('should update lastSeenAt on each check', async () => {
      const firstSeenAt = Date.now() - 600000; // 10 minutes ago
      const lastSeenAt = Date.now() - 300000; // 5 minutes ago

      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-timestamp',
          queueName: 'test-dlq',
          firstSeenAt,
          lastSeenAt,
          retryCount: 1,
        },
      });

      dynamoMock.on(PutCommand).resolves({});

      const beforeCall = Date.now();
      await checkAndRecordMessage('msg-timestamp', 'test-dlq');
      const afterCall = Date.now();

      const putCall = dynamoMock.commandCalls(PutCommand)[0];
      const updatedLastSeenAt = putCall?.args[0]?.input.Item?.lastSeenAt as number;

      // lastSeenAt should be updated to now
      expect(updatedLastSeenAt).toBeGreaterThanOrEqual(beforeCall);
      expect(updatedLastSeenAt).toBeLessThanOrEqual(afterCall);
    });
  });

  describe('getRetryCount', () => {
    it('should return retry count for existing message', async () => {
      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-existing',
          queueName: 'webhook-dlq',
          retryCount: 3,
        },
      });

      const retryCount = await getRetryCount('msg-existing', 'webhook-dlq');

      expect(retryCount).toBe(3);
    });

    it('should return 0 for non-existent message', async () => {
      dynamoMock.on(GetCommand).resolves({});

      const retryCount = await getRetryCount('msg-not-found', 'test-dlq');

      expect(retryCount).toBe(0);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      dynamoMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const retryCount = await getRetryCount('msg-error', 'test-dlq');

      expect(retryCount).toBe(0);
    });

    it('should handle missing retryCount field', async () => {
      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-no-retry-count',
          queueName: 'test-dlq',
          // retryCount field missing
        },
      });

      const retryCount = await getRetryCount('msg-no-retry-count', 'test-dlq');

      expect(retryCount).toBe(0);
    });
  });
});
