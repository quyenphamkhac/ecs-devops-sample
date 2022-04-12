import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";

export class EcsDevopsSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const repository = new ecr.Repository(
      this,
      "ecs-devops-sandbox-repository",
      { repositoryName: "ecs-devops-sandbox-repository" }
    );

    const vpc = new ec2.Vpc(this, "ecs-devops-sandbox-vpc", {
      maxAzs: 2,
    });

    const cluster = new ecs.Cluster(this, "ecs-devops-sandbox-cluster", {
      clusterName: "ecs-devops-sandbox-cluster",
      vpc: vpc,
    });

    const executionRole = new iam.Role(
      this,
      "ecs-devops-sandbox-execution-role",
      {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        roleName: "ecs-devops-sandbox-execution-role",
      }
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
      })
    );

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "ecs-devops-sandbox-task-definition",
      {
        executionRole: executionRole,
        family: "ecs-devops-sandbox-task-definition",
      }
    );

    const container = taskDefinition.addContainer(
      "ecs-devops-sandbox-container",
      {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      }
    );

    const service = new ecs.FargateService(this, "ecs-devops-sandbox-service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: "ecs-devops-sandbox-service",
    });
  }
}
