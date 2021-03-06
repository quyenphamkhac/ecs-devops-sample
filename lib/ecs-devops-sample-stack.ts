import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
// import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
// import * as codebuild from "aws-cdk-lib/aws-codebuild";
// import * as codepipeline from "aws-cdk-lib/aws-codepipeline";

export class EcsDevopsSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const repository = new ecr.Repository(
      this,
      "ecs-devops-sandbox-repository",
      {
        repositoryName: "ecs-devops-sandbox",
      }
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
        internetFacing: true,
      }
    );

    const targetGroupBlue = new elbv2.ApplicationTargetGroup(
      this,
      "target-group",
      {
        targetType: elbv2.TargetType.IP,
        protocol: elbv2.ApplicationProtocol.HTTP,
        port: 80,
        vpc: vpc,
        healthCheck: {
          path: "/",
        },
      }
    );

    const targetGroupGreen = new elbv2.ApplicationTargetGroup(
      this,
      "target-group-green",
      {
        targetType: elbv2.TargetType.IP,
        protocol: elbv2.ApplicationProtocol.HTTP,
        port: 80,
        vpc: vpc,
        healthCheck: {
          path: "/",
        },
      }
    );

    // Create a new Load Balancer Listener
    const listener = elb.addListener("ecs-devops-sandbox-listener", {
      port: 80,
      open: true,
    });

    listener.addTargetGroups("ecs-devops-sandbox-target-group", {
      targetGroups: [targetGroupBlue],
    });

    const elbSG = new ec2.SecurityGroup(this, "ecs-devops-sandbox-elb-sg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    // Allow access from around the world
    elbSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP traffic from the world"
    );

    // Attach the ELB to the Security Group
    elb.addSecurityGroup(elbSG);

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

    const taskRole = new iam.Role(this, "ecs-devops-sandbox-task-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: "ecs-devops-sandbox-task-role",
      description: "ECS Task Role",
    });

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["ses:SendEmail"],
      })
    );

    // Create ECS CodeDeploy Service Role
    const ecsCodeDeployRole = new iam.Role(this, "ecs-codedeploy-role", {
      assumedBy: new iam.ServicePrincipal("codedeploy.amazonaws.com"),
      roleName: "ecs-codedeploy-role",
      description: "ECS CodeDeploy Role",
    });

    ecsCodeDeployRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCodeDeployRoleForECS")
    );

    ecsCodeDeployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [taskRole.roleArn, executionRole.roleArn],
        actions: ["iam:PassRole"],
      })
    );

    // Create a new ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "ecs-devops-sandbox-task-definition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
        executionRole: executionRole,
        family: "ecs-devops-sandbox-task-definition",
        taskRole: taskRole,
      }
    );

    const container = taskDefinition.addContainer(
      "ecs-devops-sandbox-container",
      {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryReservationMiB: 512,
        environment: {
          SANDBOX_ELB_DNS: elb.loadBalancerDnsName,
        },
        logging: new ecs.AwsLogDriver({
          streamPrefix: "ecs-devops-sandbox",
          mode: ecs.AwsLogDriverMode.NON_BLOCKING,
          logRetention: logs.RetentionDays.ONE_MONTH,
        }),
      }
    );

    container.addPortMappings({ containerPort: 80 });

    const serviceSG = new ec2.SecurityGroup(
      this,
      "ecs-devops-sandbox-service-sg",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );

    serviceSG.connections.allowFrom(
      elbSG,
      ec2.Port.allTcp(),
      "Allow traffic from the ELB"
    );

    // Create a new ECS service
    const service = new ecs.FargateService(this, "ecs-devops-sandbox-service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      securityGroups: [serviceSG],
      assignPublicIp: true,
      desiredCount: 2,
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY,
      },
      enableECSManagedTags: true,
      serviceName: "ecs-devops-sandbox-service",
    });

    // Attach the ELB Target Group to the service
    service.attachToApplicationTargetGroup(targetGroupBlue);

    const scalableTarget = service.autoScaleTaskCount({
      maxCapacity: 3,
      minCapacity: 2,
    });

    scalableTarget.scaleOnCpuUtilization("ecs-devops-sandbox-cpu-scaling", {
      targetUtilizationPercent: 50,
    });

    scalableTarget.scaleOnMemoryUtilization(
      "ecs-devops-sandbox-memory-scaling",
      {
        targetUtilizationPercent: 50,
      }
    );
  }
}
