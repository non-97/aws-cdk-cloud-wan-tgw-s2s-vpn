import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { TransitGateway } from '../../lib/constructs';
import { TGW1_CONFIG } from '../../lib/network-config';

describe('TransitGateway', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  new TransitGateway(stack, 'Tgw', {
    amazonSideAsn: TGW1_CONFIG.amazonSideAsn,
  });
  const template = Template.fromStack(stack);

  test('creates a Transit Gateway with default RT disabled and an explicit RT', () => {
    template.hasResourceProperties('AWS::EC2::TransitGateway', {
      AmazonSideAsn: TGW1_CONFIG.amazonSideAsn,
      DefaultRouteTableAssociation: 'disable',
      DefaultRouteTablePropagation: 'disable',
      VpnEcmpSupport: 'enable',
    });
    template.resourceCountIs('AWS::EC2::TransitGatewayRouteTable', 1);
  });

  test('uses the provided Amazon side ASN', () => {
    const otherApp = new cdk.App();
    const otherStack = new cdk.Stack(otherApp, 'OtherStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    new TransitGateway(otherStack, 'Tgw', { amazonSideAsn: 64999 });
    Template.fromStack(otherStack).hasResourceProperties(
      'AWS::EC2::TransitGateway',
      { AmazonSideAsn: 64999 },
    );
  });
});
