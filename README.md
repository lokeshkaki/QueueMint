# QueueMint

Self-healing DLQ recovery for AWS SQS.

QueueMint classifies failed messages, retries the safe ones, archives the rest, and escalates systemic issues with clear context. It is designed to cut manual DLQ work without losing accountability.

## What It Does

- Classifies failures into transient, poison pill, or systemic categories
- Automatically retries transient failures with safe backoff
- Archives unrecoverable messages with analysis and traceability
- Escalates systemic issues with deployment correlation

## How It Works

1. DLQ Monitor polls and enriches messages.
2. Failure Analyzer classifies with heuristics and LLMs.
3. Action Executors route to retry, archive, or escalation.

## Get Started

Start here: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Operations](docs/OPERATIONS.md)
- [Classification](docs/CLASSIFICATION.md)
- [Metrics and Costs](docs/METRICS_AND_COSTS.md)

## Status

MVP implementation in progress.

## Contributing

Issues and suggestions are welcome. Pull requests are not currently accepted.

## License

MIT License - See LICENSE file for details.

## Related Projects

QueueMint integrates with [Pullmint](https://github.com/lokeshkaki/Pullmint).