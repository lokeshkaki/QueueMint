# Operations

## Monitoring

CloudWatch dashboard:

```bash
open # Dashboard available in AWS Console -> CloudWatch -> Dashboards\n# Look for: <project-name>-Self-Healing-DLQ
```

## Manual Operations

Replay a message:

```bash
aws sqs send-message \
  --queue-url <source-queue-url> \
  --message-body "$(aws s3 cp s3://<bucket-name>/poison-pills/... -)"
```

Check classification:

```bash
aws dynamodb get-item \
  --table-name <table-name>-failure-analysis \
  --key '{"messageId": {"S": "your-message-id"}}'
```

Disable auto-replay (emergency):

```bash
aws ssm put-parameter \
  --name /<project-name>/dlq/features/autoReplayEnabled \
  --value "false" \
  --overwrite
```
