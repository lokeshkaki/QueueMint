/**
 * Unit tests for DLQ Monitor Lambda
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  SQSClient,
  ListQueuesCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { EventBridgeEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';

import { handler } from '../src/index';

// Create mocks
const sqsMock = mockClient(SQSClient);
const eventBridgeMock = mockClient(EventBridgeClient);
const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('DLQ Monitor Lambda', () => {
  beforeEach(() => {
    // Reset mocks before each test
    sqsMock.reset();
    eventBridgeMock.reset();
    dynamoMock.reset();

    // Suppress console.log during tests
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handler', () => {
    it('should process messages from DLQs successfully', async () => {
      // Setup mocks
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789/test-dlq'],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: 'msg-123',
            ReceiptHandle: 'receipt-123',
            Body: JSON.stringify({
              error: {
                name: 'TimeoutError',
                message: 'ETIMEDOUT: connection timeout',
                stack: 'Error: ETIMEDOUT\n    at Socket.emit',
              },
            }),
            Attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: String(Date.now()),
              ApproximateFirstReceiveTimestamp: String(Date.now()),
            },
          },
        ],
      });

      // Mock deduplication - first time seeing message
      dynamoMock.on(GetCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      // Mock EventBridge
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      // Mock message deletion
      sqsMock.on(DeleteMessageCommand).resolves({});

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Verify interactions
      expect(sqsMock.calls()).toHaveLength(3); // ListQueues, ReceiveMessage, DeleteMessage
      expect(eventBridgeMock.calls()).toHaveLength(1); // PutEvents
    });

    it('should handle no messages in DLQ', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789/test-dlq'],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [],
      });

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should not forward to EventBridge if no messages
      expect(eventBridgeMock.calls()).toHaveLength(0);
    });

    it('should handle no DLQs found', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: [],
      });

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should complete without errors
      expect(sqsMock.calls()).toHaveLength(1); // Only ListQueues
    });

    it('should skip messages exceeding retry limit', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789/test-dlq'],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: 'msg-retry-exceeded',
            ReceiptHandle: 'receipt-456',
            Body: JSON.stringify({ error: 'Test error' }),
            Attributes: {
              ApproximateReceiveCount: '5',
              SentTimestamp: String(Date.now()),
              ApproximateFirstReceiveTimestamp: String(Date.now()),
            },
          },
        ],
      });

      // Mock deduplication - message seen 4 times already
      dynamoMock.on(GetCommand).resolves({
        Item: {
          messageId: 'msg-retry-exceeded',
          queueName: 'test-dlq',
          firstSeenAt: Date.now() - 3600000,
          lastSeenAt: Date.now(),
          retryCount: 4,
        },
      });

      dynamoMock.on(PutCommand).resolves({});
      sqsMock.on(DeleteMessageCommand).resolves({});

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should delete message but not forward to EventBridge
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
      expect(eventBridgeMock.calls()).toHaveLength(0);
    });

    it('should handle EventBridge forwarding errors gracefully', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789/test-dlq'],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: 'msg-forward-error',
            ReceiptHandle: 'receipt-789',
            Body: JSON.stringify({ error: 'Test error' }),
            Attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: String(Date.now()),
              ApproximateFirstReceiveTimestamp: String(Date.now()),
            },
          },
        ],
      });

      dynamoMock.on(GetCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      // Simulate EventBridge failure
      eventBridgeMock.on(PutEventsCommand).rejects(new Error('EventBridge unavailable'));

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should not delete message on EventBridge error
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    });
  });

  describe('queue discovery', () => {
    it('should filter queues by DLQ pattern', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: [
          'https://sqs.us-east-1.amazonaws.com/123456789/webhook-dlq',
          'https://sqs.us-east-1.amazonaws.com/123456789/deployment-dlq',
          'https://sqs.us-east-1.amazonaws.com/123456789/regular-queue',
          'https://sqs.us-east-1.amazonaws.com/123456789/github-dlq',
        ],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should poll only DLQs (those containing '-dlq')
      const receiveCommands = sqsMock.commandCalls(ReceiveMessageCommand);
      expect(receiveCommands).toHaveLength(3); // webhook-dlq, deployment-dlq, github-dlq
    });

    it('should handle SQS errors gracefully', async () => {
      sqsMock.on(ListQueuesCommand).rejects(new Error('SQS service error'));

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should complete without crashing
      expect(sqsMock.calls()).toHaveLength(1);
    });

    it('should handle polling errors for individual queues', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: [
          'https://sqs.us-east-1.amazonaws.com/123456789/test-dlq',
          'https://sqs.us-east-1.amazonaws.com/123456789/error-dlq',
        ],
      });

      sqsMock
        .on(ReceiveMessageCommand)
        .resolvesOnce({
          Messages: [
            {
              MessageId: 'msg-success',
              ReceiptHandle: 'receipt-success',
              Body: JSON.stringify({ error: 'test' }),
              Attributes: {
                ApproximateReceiveCount: '1',
                SentTimestamp: String(Date.now()),
                ApproximateFirstReceiveTimestamp: String(Date.now()),
              },
            },
          ],
        })
        .rejectsOnce(new Error('Queue poll error'));

      dynamoMock.on(GetCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });
      sqsMock.on(DeleteMessageCommand).resolves({});

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should process the successful queue
      expect(eventBridgeMock.calls()).toHaveLength(1);
    });

    it('should handle messages without MessageId', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789/test-dlq'],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            // No MessageId
            ReceiptHandle: 'receipt-no-id',
            Body: JSON.stringify({ error: 'test' }),
            Attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: String(Date.now()),
              ApproximateFirstReceiveTimestamp: String(Date.now()),
            },
          },
        ],
      });

      dynamoMock.on(GetCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });
      sqsMock.on(DeleteMessageCommand).resolves({});

      const event = {
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        detail: {},
      } as EventBridgeEvent<string, unknown>;

      await handler(event);

      // Should still process message with 'unknown' ID
      expect(eventBridgeMock.calls()).toHaveLength(1);
    });

    it('should handle CloudWatch Alarm events', async () => {
      sqsMock.on(ListQueuesCommand).resolves({
        QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789/test-dlq'],
      });

      sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

      const alarmEvent = {
        detail: {
          alarmName: 'DLQ-Depth-Alarm',
          state: {
            value: 'ALARM',
            reason: 'Threshold crossed',
          },
        },
      } as EventBridgeEvent<'CloudWatch Alarm State Change', unknown>;

      await handler(alarmEvent);

      // Should process alarm events
      expect(sqsMock.calls()).toHaveLength(2); // ListQueues, ReceiveMessage
    });
  });
});
