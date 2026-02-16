# Classification

QueueMint classifies failures into three categories and routes them to the appropriate recovery path.

## Categories

- TRANSIENT: network timeouts, throttling, upstream instability.
- POISON_PILL: corrupt payloads, schema mismatches, invalid data.
- SYSTEMIC: deployment regressions, widespread outages, config errors.

## Examples

Transient failure (auto-recovered):

```
Error: "ETIMEDOUT: socket hang up"
Classification: TRANSIENT (confidence: 0.96)
Action: Replayed with 60s delay
Outcome: SUCCESS after 1 retry
MTTR: 2 minutes
```

Poison pill (manual review):

```
Error: "Cannot read property 'length' of null"
Classification: POISON_PILL (confidence: 0.92)
Action: Archived to S3 with analysis
Alert: SNS notification to engineering team
Suggested Fix: "Validate diff is not null before processing"
```

Systemic issue (escalated):

```
Error: "ReferenceError: newFunction is not defined"
Similar Failures: 47 in last 15 minutes
Recent Deployment: v2.1.0 (12 minutes ago)
Classification: SYSTEMIC (confidence: 0.98)
Action: PagerDuty P1 incident created
Recommendation: Rollback to v2.0.9
```
