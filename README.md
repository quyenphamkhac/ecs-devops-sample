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
Hope you have fun ^^ Let's get started

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
