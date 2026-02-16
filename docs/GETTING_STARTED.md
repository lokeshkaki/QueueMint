# Getting Started

## Prerequisites

- AWS account with CLI configured
- Node.js 20+
- AWS CDK CLI
- Anthropic API key

## Install

```bash
git clone https://github.com/lokeshkaki/QueueMint.git
cd QueueMint
npm install
```

## Configure AWS

```bash
aws configure
```

## Store the Anthropic API Key

```bash
aws secretsmanager create-secret \
  --name pullmint/anthropic-api-key \
  --secret-string '{"apiKey":"your-key-here"}'
```

## Deploy

```bash
cd infrastructure
npm run deploy
```
