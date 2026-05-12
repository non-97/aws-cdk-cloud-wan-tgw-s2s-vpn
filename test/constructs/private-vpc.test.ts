import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PrivateVpc } from '../../lib/constructs';
import { cloudWanSegment, cloudWanTagKey } from '../../lib/network-config';

const env = { account: '123456789012', region: 'ap-northeast-1' };

describe('PrivateVpc with Cloud WAN attachment', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env });
  new PrivateVpc(stack, 'CloudWanPrivateVpc', {
    vpcCidr: '10.0.0.0/16',
    attachment: {
      kind: 'cloudWan',
      coreNetworkId: 'cn-123',
      coreNetworkArn:
        'arn:aws:networkmanager::123456789012:core-network/cn-123',
      segmentTag: cloudWanSegment.Prod,
    },
  });
  const template = Template.fromStack(stack);

  test('creates VPC with the given CIDR and 2 subnets', () => {
    template.hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.0.0.0/16' });
    template.resourceCountIs('AWS::EC2::Subnet', 2);
  });

  test('creates a Cloud WAN VPC attachment with prod segment tag', () => {
    template.resourceCountIs('AWS::NetworkManager::VpcAttachment', 1);
    template.hasResourceProperties('AWS::NetworkManager::VpcAttachment', {
      CoreNetworkId: 'cn-123',
      Tags: Match.arrayWith([
        { Key: cloudWanTagKey.Segment, Value: cloudWanSegment.Prod },
      ]),
    });
  });

  test('routes 0.0.0.0/0 from private subnet to the Core Network ARN', () => {
    template.hasResourceProperties('AWS::EC2::Route', {
      DestinationCidrBlock: '0.0.0.0/0',
      CoreNetworkArn: 'arn:aws:networkmanager::123456789012:core-network/cn-123',
    });
  });

  test('does not create a TGW attachment', () => {
    template.resourceCountIs('AWS::EC2::TransitGatewayVpcAttachment', 0);
  });

  test('creates an EIC Endpoint and an EC2 instance', () => {
    template.resourceCountIs('AWS::EC2::InstanceConnectEndpoint', 1);
    template.resourceCountIs('AWS::EC2::Instance', 1);
  });
});

describe('PrivateVpc with TGW attachment', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env });
  new PrivateVpc(stack, 'TgwPrivateVpc', {
    vpcCidr: '10.10.0.0/16',
    attachment: {
      kind: 'tgw',
      transitGatewayId: 'tgw-abc',
      routeTableId: 'tgw-rtb-abc',
    },
  });
  const template = Template.fromStack(stack);

  test('creates VPC with the given CIDR', () => {
    template.hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.10.0.0/16' });
  });

  test('creates a TGW VPC attachment with explicit association/propagation', () => {
    template.resourceCountIs('AWS::EC2::TransitGatewayVpcAttachment', 1);
    template.resourceCountIs('AWS::NetworkManager::VpcAttachment', 0);
    template.hasResourceProperties('AWS::EC2::TransitGatewayVpcAttachment', {
      TransitGatewayId: 'tgw-abc',
    });
    template.hasResourceProperties(
      'AWS::EC2::TransitGatewayRouteTableAssociation',
      { TransitGatewayRouteTableId: 'tgw-rtb-abc' },
    );
    template.hasResourceProperties(
      'AWS::EC2::TransitGatewayRouteTablePropagation',
      { TransitGatewayRouteTableId: 'tgw-rtb-abc' },
    );
  });

  test('routes 0.0.0.0/0 from private subnet to TGW', () => {
    template.hasResourceProperties('AWS::EC2::Route', {
      DestinationCidrBlock: '0.0.0.0/0',
      TransitGatewayId: 'tgw-abc',
    });
  });
});
