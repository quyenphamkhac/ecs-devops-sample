import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

export class EcsDevopsSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a new repository
    const repository = new ecr.Repository(
      this,
      "ecs-devops-sandbox-repository",
      { repositoryName: "ecs-devops-sandbox-repository" }
    );

    // Create a new vpc with public subnets
    const vpc = new ec2.Vpc(this, "ecs-devops-sandbox-vpc", {
      vpcName: "ecs-devops-sandbox-vpc",
      maxAzs: 2,
      cidr: "10.0.0.0/16",
      subnetConfiguration: [
        {
          name: "ecs-devops-sandbox-subnet-public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "ecs-devops-sandbox-subnet-private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Create a new Elastic Load Balancer
    const elb = new elbv2.ApplicationLoadBalancer(
      this,
      "ecs-devops-sandbox-elb",
      {
        vpc: vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      }
    );

    // Create a new Load Balancer Listener
    const listener = elb.addListener("ecs-devops-sandbox-listener", {
      port: 80,
    });

    // Create a new ECS cluster
    const cluster = new ecs.Cluster(this, "ecs-devops-sandbox-cluster", {
      clusterName: "ecs-devops-sandbox-cluster",
      vpc: vpc,
    });

    // Create a new ECS execution role
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

    // Create a new ECS task definition
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

    // Create a new ECS service
    const service = new ecs.FargateService(this, "ecs-devops-sandbox-service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: "ecs-devops-sandbox-service",
    });
  }
}
