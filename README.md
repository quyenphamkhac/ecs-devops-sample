# ECS Cluster CI/CD

This repository contains a set of configuration to setup a CI/CD pipeline for an AWS ECS Cluster.
All configuration powered by [AWS Cloud Development Kit](https://github.com/awslabs/aws-cdk).
Hope you have fun ^^ Let's get started

## Table of Contents
1. [About this Repo](#About)
2. [Cdk Setup](#CdkSetup)
3. [Network Setup](#NetworkSetup)
4. [ECS Cluster Setup](#ECSSetup)
5. [CodePipeline Setup](#PipelineSetup)
6. [License](#License)

## About this Repo <a name="About"></a>
In this repo, I give a step-by-step guide for deploying applications to ECS Fargate use AWS CodePipeline with AWS CDK.
Hope you have fun ^^ Let's get started. The image below gives an overview of what we are going to create using CDK.

![ECS CI/CD Architecture](/design.png)

## Cdk Setup <a name="CdkSetup"></a>

Install or update the [AWS CDK CLI] from npm (requires [Node.js ≥ 14.15.0](https://nodejs.org/download/release/latest-v14.x/)). We recommend using a version in [Active LTS](https://nodejs.org/en/about/releases/)

```console
npm i -g aws-cdk
```

Bootstrap Cdk assets if you run Cdk the first time:
```console
cdk bootstrap
```

Deploy this to your account:
```console
cdk deploy
```

## Network Setup <a name="NetworkSetup"></a>

To be able to connect to the ECS cluster you need to create an Application Load Balancer in front of the ECS service.

Create a new vpc with 2 public subnets:
```typescript
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
```

Create a new Application Load Balancer:
```typescript
const elb = new elbv2.ApplicationLoadBalancer(
  this,
  "ecs-devops-sandbox-elb",
  {
    vpc: vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    internetFacing: true,
  }
);
```

Create new target group with health check config for containers to be deployed to:
```typescript
const targetGroup = new elbv2.ApplicationTargetGroup(this, "target-group", {
  targetType: elbv2.TargetType.IP,
  protocol: elbv2.ApplicationProtocol.HTTP,
  port: 8080,
  vpc: vpc,
  healthCheck: {
    // My custom health check
    path: "/api/v1/health",
  },
});
```

Create a new HTTP listener for HTTP requests around the world on port 80:
```typescript
const listener = elb.addListener("ecs-devops-sandbox-listener", {
  port: 80,
  open: true,
});

listener.addTargetGroups("ecs-devops-sandbox-target-group", {
  targetGroups: [targetGroup],
});
```

Create a new Security Group and attach it to Application Load Balancer:
```typescript
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
```

## ECS Cluster Setup <a name="ECSSetup"></a>
This section helps to create all the resources in ECS and connects them to the application load balancer. It creates the following resources:

Create a new ECS cluster:
```typescript
const cluster = new ecs.Cluster(this, "ecs-devops-sandbox-cluster", {
  clusterName: "ecs-devops-sandbox-cluster",
  vpc: vpc,
});
```

Create a new ECS execution role help your cluster has permission for pulling image from AWS ECR and pushing logs to AWS Cloudwatch:
```typescript
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
```

You also need to create a task role that help the task and its containers can access AWS Resources through IAM Role:
```typescript
const taskRole = new iam.Role(this, "ecs-devops-sandbox-task-role", {
  assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
  roleName: "ecs-devops-sandbox-task-role",
  description: "ECS Task Role",
});

// Allow sendEmail
taskRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ["*"],
    actions: ["ses:SendEmail"],
  })
);
```

Create a new ECS task definition:
```typescript
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
```

Create a new docker container including the image to use:
```typescript
const container = taskDefinition.addContainer(
  "ecs-devops-sandbox-container",
  {
    image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    memoryReservationMiB: 512,
    environment: {
      SANDBOX_ELB_DNS: elb.loadBalancerDnsName,
    },
    // Store the logs in cloudwatch
    logging: new ecs.AwsLogDriver({ streamPrefix: "ecs-devops-sandbox" }),
  }
);
```

Mapping port for containers:
```typescript
container.addPortMappings({ containerPort: 80 });
```

Create a new Security groups to allow connections from the application load balancer to the fargate containers:
```typescript
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
```

Create a new ECS Fargate Service user for deploying tasks:
```typescript
const service = new ecs.FargateService(this, "ecs-devops-sandbox-service", {
  cluster: cluster,
  taskDefinition: taskDefinition,
  securityGroups: [serviceSG],
  assignPublicIp: true,
  desiredCount: 1,
  serviceName: "ecs-devops-sandbox-service",
});
```

Attach ECS Fargate Service to Target Group that we've created before:
```typescript
service.attachToApplicationTargetGroup(targetGroup);
```

Create a new Scalable Target for tasks based on CPU and Memory Utilization:
```typescript
const scalableTarget = service.autoScaleTaskCount({
  maxCapacity: 3,
  minCapacity: 1,
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
```

## CodePipeline Setup <a name="PipelineSetup"></a>
In progress ...

## License <a name="License"></a>
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)  
