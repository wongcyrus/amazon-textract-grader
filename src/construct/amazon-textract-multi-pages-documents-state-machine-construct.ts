import { Duration } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Choice, StateMachine, Wait } from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

import { Construct } from 'constructs';


export interface AmazonTextractMultiPagesDocumentsStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  destinationBucket: Bucket;
}

export class AmazonTextractMultiPagesDocumentsStateMachineConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  public readonly destinationBucket: Bucket;
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: AmazonTextractMultiPagesDocumentsStateMachineConstructProps) {
    super(scope, id);
    this.pdfSourceBucket = props.pdfSourceBucket;
    this.destinationBucket = props.destinationBucket;

    const amazonTextractJobCompleteTopic = new sns.Topic(this, 'AmazonTextractJobCompleteTopic');

    const textractExecutionRole = new Role(this, 'TextractExecutionRole', {
      assumedBy: new ServicePrincipal('textract.amazonaws.com'),
    });

    textractExecutionRole.addToPolicy(new PolicyStatement({
      resources: [amazonTextractJobCompleteTopic.topicArn],
      actions: ['SNS:Publish'],
    }));

    const runAmazonTextract = new tasks.CallAwsService(this, 'RunAmazonTextract', {
      service: 'textract',
      action: 'startDocumentAnalysis',
      parameters: {
        ClientRequestToken: sfn.JsonPath.stringAt('$$.Execution.Name'),
        DocumentLocation: {
          S3Object: {
            Bucket: this.pdfSourceBucket.bucketName,
            Name: sfn.JsonPath.stringAt('$.key'),
          },
        },
        FeatureTypes: ['FORMS', 'TABLES'],
        JobTag: sfn.JsonPath.stringAt('$$.Execution.Name'),
        // NotificationChannel: {
        //   RoleArn: textractExecutionRole.roleArn,
        //   SnsTopicArn: amazonTextractJobCompleteTopic.topicArn,
        // },
        OutputConfig: {
          S3Bucket: this.destinationBucket.bucketName,
          S3Prefix: sfn.JsonPath.stringAt('$.key'),
        },
      },
      iamResources: ['*'],
      iamAction: 'textract:StartDocumentAnalysis',
      resultSelector: {
        JobId: sfn.JsonPath.stringAt('$.JobId'),
      },
      resultPath: '$.textract',
    });

    const getDocumentAnalysis = new tasks.CallAwsService(this, 'GetDocumentAnalysis', {
      service: 'textract',
      action: 'getDocumentAnalysis',
      parameters: {
        JobId: sfn.JsonPath.stringAt('$.textract.JobId'),
        MaxResults: 1,
      },
      iamResources: ['*'],
      iamAction: 'textract:GetDocumentAnalysis',
      resultSelector: {
        JobStatus: sfn.JsonPath.stringAt('$.JobStatus'),
      },
      resultPath: '$.status',
    });

    const jobFailed = new sfn.Fail(this, 'Job Failed', {
      cause: 'Amazon Textract Job Failed',
      error: 'DescribeJob returned FAILED',
    });
    const jobFinish = new sfn.Pass(this, 'Job Finish', {
      comment: 'AWS Textract Job Finish',
      parameters: {
        key: sfn.JsonPath.stringAt('$.key'),
        JobId: sfn.JsonPath.stringAt('$.textract.JobId'),
        textractPrefix: sfn.JsonPath.stringAt('States.Format(\'{}/{}\', $.key, $.textract.JobId)'),
      },
    });

    const wait = new Wait(this, 'Wait 1 minute', {
      comment: 'Wait 1 minute\'',
      time: sfn.WaitTime.duration(Duration.minutes(1)),
    });

    const choice = new Choice(this, 'Check Job Status')
      .when(sfn.Condition.stringEquals('$.status.JobStatus', 'FAILED'), jobFailed)
      .when(sfn.Condition.stringEquals('$.status.JobStatus', 'SUCCEEDED'), jobFinish)
      .otherwise(wait);

    const definition = runAmazonTextract.next(wait).next(getDocumentAnalysis).next(choice);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
    this.stateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: ['*'],
      }),
    );
    this.stateMachine.role.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonTextractFullAccess' });
  }
}
