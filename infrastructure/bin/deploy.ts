#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { SelfHealingDLQStack } from '../lib/self-healing-dlq-stack';

const app = new cdk.App();

// Get environment from context (dev, staging, prod)
const env = app.node.tryGetContext('env') || 'dev';

new SelfHealingDLQStack(app, `QueueMint-${env}`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] || 'us-east-1',
  },
  stackName: `queuemint-self-healing-dlq-${env}`,
  description: `QueueMint Self-Healing DLQ System - ${env}`,
  tags: {
    Project: 'QueueMint',
    Environment: env,
    ManagedBy: 'CDK',
  },
});
