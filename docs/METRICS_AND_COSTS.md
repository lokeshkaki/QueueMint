# Metrics and Costs

## Performance Targets

| Metric | Target |
| --- | --- |
| Auto-Recovery Rate | >80% |
| Classification Accuracy | >85% |
| False Positive Rate | <10% |
| MTTR (Transient) | <5 min |
| Classification Latency (p95) | <5s |
| Cost per Message | <$0.03 |

## Cost Estimate (500 messages/month)

- Lambda: $0.05
- DynamoDB: $1.00
- Anthropic API: $4.90 (with caching)
- Other AWS services: $0.56
- Total: $6.51/month ($0.013 per message)
