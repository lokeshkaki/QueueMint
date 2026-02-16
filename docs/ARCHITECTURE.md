# Architecture

QueueMint is an event-driven system that turns DLQ messages into classified recovery actions with full auditability.

## Core Components

- DLQ Monitor (Lambda): polls DLQs, deduplicates, enriches, and forwards messages.
- Failure Analyzer (Lambda): classifies failures using heuristics and LLMs.
- Action Executors (Lambda): routes to retry, archive, or escalation actions.
- Data Stores: DynamoDB for state, S3 for poison-pill archives.
- Routing: EventBridge for message fan-out and workflow decoupling.

## Data Flow

1. DLQ Monitor polls SQS DLQs and deduplicates messages in DynamoDB.
2. The message is enriched with retry history and recent deployment context.
3. Failure Analyzer classifies the failure and stores the result.
4. Action Executors perform retry, archive, or escalation actions.

## Data Model (DynamoDB)

FailureAnalysis
- Partition key: messageId (String)
- Attributes: timestamp, sourceQueue, classification, confidence, errorMessage, actionTaken, recoveryOutcome, semanticHash, ttl
- GSIs: ByQueueTimestamp, ByClassificationTimestamp, BySemanticHash, ByDeploymentTimestamp

## Technology Stack

- Runtime: TypeScript 5.3, Node.js 20
- Infrastructure: AWS CDK, Lambda, SQS, DynamoDB, S3, EventBridge, SNS
- AI: Anthropic Claude Sonnet 4.5, Claude Haiku 3.5
- Observability: CloudWatch, X-Ray, PagerDuty
