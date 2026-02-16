# Operations

## Monitoring

CloudWatch dashboard:

```bash
open https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=Pullmint-Self-Healing-DLQ
```

## Manual Operations

Replay a message:

```bash
aws sqs send-message \
  --queue-url <source-queue-url> \
  --message-body "$(aws s3 cp s3://pullmint-dlq-analysis/poison-pills/... -)"
```

Check classification:

```bash
aws dynamodb get-item \
  --table-name pullmint-dlq-failure-analysis \
  --key '{"messageId": {"S": "your-message-id"}}'
```

Disable auto-replay (emergency):

```bash
aws ssm put-parameter \
  --name /pullmint/dlq/features/autoReplayEnabled \
  --value "false" \
  --overwrite
```
