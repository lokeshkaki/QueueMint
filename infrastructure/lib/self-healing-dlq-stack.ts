import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * QueueMint Self-Healing DLQ Stack
 * 
 * Infrastructure:
 * - Lambda functions (DLQ Monitor, Failure Analyzer, Action Executors)
 * - DynamoDB tables (FailureAnalysis, MessageDeduplication, SemanticCache)
 * - S3 bucket (poison pill archive)
 * - EventBridge event bus (message routing)
 * - CloudWatch dashboard and alarms
 * - IAM roles with least-privilege permissions
 */
export class SelfHealingDLQStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const envName = this.node.tryGetContext('env') ?? 'dev';
    const retainResources = envName === 'prod';
    const removalPolicy = retainResources ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    const failureAnalysisTable = new dynamodb.Table(this, 'FailureAnalysisTable', {
      tableName: `queuemint-failure-analysis-${envName}`,
      partitionKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy,
    });

    failureAnalysisTable.addGlobalSecondaryIndex({
      indexName: 'ByQueueTimestamp',
      partitionKey: { name: 'sourceQueue', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    failureAnalysisTable.addGlobalSecondaryIndex({
      indexName: 'ByClassificationTimestamp',
      partitionKey: { name: 'classification', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    failureAnalysisTable.addGlobalSecondaryIndex({
      indexName: 'BySemanticHash',
      partitionKey: { name: 'semanticHash', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    const messageDeduplicationTable = new dynamodb.Table(this, 'MessageDeduplicationTable', {
      tableName: `queuemint-message-deduplication-${envName}`,
      partitionKey: { name: 'dedupKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy,
    });

    const poisonPillArchiveBucket = new s3.Bucket(this, 'PoisonPillArchiveBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
      removalPolicy,
      autoDeleteObjects: !retainResources,
    });

    const dlqEventBus = new events.EventBus(this, 'DLQEventBus', {
      eventBusName: `queuemint-dlq-events-${envName}`,
    });

    const dlqMonitorRole = new iam.Role(this, 'DLQMonitorRole', {
      roleName: `queuemint-dlq-monitor-role-${envName}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'QueueMint DLQ Monitor Lambda execution role',
    });

    dlqMonitorRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );
    messageDeduplicationTable.grantReadWriteData(dlqMonitorRole);
    failureAnalysisTable.grantReadData(dlqMonitorRole);
    dlqEventBus.grantPutEventsTo(dlqMonitorRole);

    const failureAnalyzerRole = new iam.Role(this, 'FailureAnalyzerRole', {
      roleName: `queuemint-failure-analyzer-role-${envName}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'QueueMint Failure Analyzer Lambda execution role',
    });

    failureAnalyzerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );
    failureAnalysisTable.grantReadWriteData(failureAnalyzerRole);
    messageDeduplicationTable.grantReadData(failureAnalyzerRole);
    dlqEventBus.grantPutEventsTo(failureAnalyzerRole);
    failureAnalyzerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:${cdk.Aws.PARTITION}:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:queuemint/*`,
        ],
      })
    );

    const actionExecutorsRole = new iam.Role(this, 'ActionExecutorsRole', {
      roleName: `queuemint-action-executors-role-${envName}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'QueueMint Action Executors Lambda execution role',
    });

    actionExecutorsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );
    failureAnalysisTable.grantReadWriteData(actionExecutorsRole);
    messageDeduplicationTable.grantReadData(actionExecutorsRole);
    poisonPillArchiveBucket.grantReadWrite(actionExecutorsRole);
    actionExecutorsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish', 'sqs:SendMessage'],
        resources: [
          `arn:${cdk.Aws.PARTITION}:sns:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:queuemint-*`,
          `arn:${cdk.Aws.PARTITION}:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:queuemint-*`,
        ],
      })
    );

    new logs.LogGroup(this, 'DLQMonitorLogGroup', {
      logGroupName: `/aws/lambda/queuemint-dlq-monitor-${envName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    new logs.LogGroup(this, 'FailureAnalyzerLogGroup', {
      logGroupName: `/aws/lambda/queuemint-failure-analyzer-${envName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    new logs.LogGroup(this, 'ActionExecutorsLogGroup', {
      logGroupName: `/aws/lambda/queuemint-action-executors-${envName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    new cdk.CfnOutput(this, 'FailureAnalysisTableName', {
      value: failureAnalysisTable.tableName,
    });

    new cdk.CfnOutput(this, 'MessageDeduplicationTableName', {
      value: messageDeduplicationTable.tableName,
    });

    new cdk.CfnOutput(this, 'PoisonPillArchiveBucketName', {
      value: poisonPillArchiveBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'DLQEventBusName', {
      value: dlqEventBus.eventBusName,
    });
  }
}
