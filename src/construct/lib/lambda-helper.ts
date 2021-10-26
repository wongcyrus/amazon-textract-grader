import path from 'path';
import * as lambda from '@aws-cdk/aws-lambda';
import { Code, IFunction, ILayerVersion, Runtime } from '@aws-cdk/aws-lambda';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';


export class LambdaHelper {
  private readonly _scope: Construct;

  constructor(scope: Construct) {
    this._scope = scope;
  }

  public getLayerVersion(assetPath: string) {
    let name = assetPath.split('/')[0];
    name = name.charAt(0).toUpperCase() + name.substring(1).toLowerCase() + 'Layer';
    return new lambda.LayerVersion(this._scope, name, {
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_14_X,
      ],
      code: Code.fromAsset(path.join(__dirname, '../lambda/layer', assetPath)),
    });
  }

  public getLambdaFunction(assetPath: string, layers: ILayerVersion[], environment: {
    [key: string]: string;
  }) {
    const functionName = assetPath.split('-').map(c => c.charAt(0).toUpperCase() + c.substring(1).toLowerCase() + 'Function').join('');
    return new lambda.Function(this._scope, functionName, {
      runtime: Runtime.NODEJS_14_X,
      memorySize: 1024,
      timeout: Duration.minutes(15),
      handler: 'app.lambdaHandler',
      code: Code.fromAsset(path.join(__dirname, '../lambda', assetPath)),
      layers: layers,
      environment,
    });
  }

  public getLambdaInvokeTask(lambdaFunction: IFunction) {
    const name = lambdaFunction.node.id.replace('Function', 'Task');
    return new tasks.LambdaInvoke(this._scope, name, {
      lambdaFunction,
      resultPath: '$.results',
      outputPath: '$.results.Payload',
    });
  }
}