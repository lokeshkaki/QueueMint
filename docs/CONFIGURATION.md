# Configuration

QueueMint uses SSM Parameter Store for feature flags and thresholds.

## Feature Flags

```bash
aws ssm put-parameter \
  --name /pullmint/dlq/features/autoReplayEnabled \
  --value "true" \
  --type String

aws ssm put-parameter \
  --name /pullmint/dlq/features/llmClassificationEnabled \
  --value "true" \
  --type String

aws ssm put-parameter \
  --name /pullmint/dlq/features/pagerdutyIntegrationEnabled \
  --value "true" \
  --type String
```

## Thresholds

```bash
aws ssm put-parameter \
  --name /pullmint/dlq/config/confidenceThreshold \
  --value "0.85" \
  --type String

aws ssm put-parameter \
  --name /pullmint/dlq/config/maxRetries \
  --value "3" \
  --type String
```
