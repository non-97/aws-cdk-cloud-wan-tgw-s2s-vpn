import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { VpnVpc } from '../../lib/constructs';
import {
  cloudWanSegment,
  cloudWanTagKey,
  CLOUD_WAN_VPN_CONFIG,
  TGW1_VPN_CONFIG,
} from '../../lib/network-config';

const env = { account: '123456789012', region: 'ap-northeast-1' };

describe('VpnVpc with Cloud WAN attachment', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env });
  new VpnVpc(stack, 'CloudWanVpnVpc', {
    vpcCidr: '10.1.0.0/16',
    attachment: {
      kind: 'cloudWan',
      coreNetworkId: 'cn-123',
      segmentTag: cloudWanSegment.Prod,
    },
    cgwBgpAsn: CLOUD_WAN_VPN_CONFIG.cgwBgpAsn,
    awsBgpAsn: CLOUD_WAN_VPN_CONFIG.awsBgpAsn,
    tunnel1InsideCidr: CLOUD_WAN_VPN_CONFIG.tunnel1InsideCidr,
    tunnel2InsideCidr: CLOUD_WAN_VPN_CONFIG.tunnel2InsideCidr,
  });
  const template = Template.fromStack(stack);

  test('creates VPC with public and private subnet', () => {
    template.hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.1.0.0/16' });
    template.resourceCountIs('AWS::EC2::Subnet', 2);
  });

  test('creates a Customer Gateway with the configured ASN', () => {
    template.hasResourceProperties('AWS::EC2::CustomerGateway', {
      Type: 'ipsec.1',
      BgpAsn: CLOUD_WAN_VPN_CONFIG.cgwBgpAsn,
    });
  });

  test('creates a VPN connection without TransitGatewayId (Cloud WAN attach)', () => {
    template.hasResourceProperties('AWS::EC2::VPNConnection', {
      Type: 'ipsec.1',
      StaticRoutesOnly: false,
      TransitGatewayId: Match.absent(),
    });
  });

  test('creates a Site-to-Site VPN attachment tagged with prod segment', () => {
    template.resourceCountIs(
      'AWS::NetworkManager::SiteToSiteVpnAttachment',
      1,
    );
    template.hasResourceProperties(
      'AWS::NetworkManager::SiteToSiteVpnAttachment',
      {
        CoreNetworkId: 'cn-123',
        Tags: Match.arrayWith([
          { Key: cloudWanTagKey.Segment, Value: cloudWanSegment.Prod },
        ]),
      },
    );
  });

  test('creates a VPN router with two ENIs and an EIP', () => {
    template.resourceCountIs('AWS::EC2::NetworkInterface', 2);
    template.resourceCountIs('AWS::EC2::EIP', 1);
    template.resourceCountIs('AWS::EC2::EIPAssociation', 1);
  });
});

describe('VpnVpc with createEicEndpoint=false', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env });
  new VpnVpc(stack, 'NoEicVpnVpc', {
    vpcCidr: '10.99.0.0/16',
    attachment: {
      kind: 'tgw',
      transitGatewayId: 'tgw-abc',
      routeTableId: 'tgw-rtb-abc',
    },
    cgwBgpAsn: TGW1_VPN_CONFIG.cgwBgpAsn,
    awsBgpAsn: TGW1_VPN_CONFIG.awsBgpAsn,
    tunnel1InsideCidr: TGW1_VPN_CONFIG.tunnel1InsideCidr,
    tunnel2InsideCidr: TGW1_VPN_CONFIG.tunnel2InsideCidr,
    createEicEndpoint: false,
  });
  const template = Template.fromStack(stack);

  test('does not create an EIC Endpoint', () => {
    template.resourceCountIs('AWS::EC2::InstanceConnectEndpoint', 0);
  });
});

describe('VpnVpc with TGW attachment', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env });
  new VpnVpc(stack, 'TgwVpnVpc', {
    vpcCidr: '10.11.0.0/16',
    attachment: {
      kind: 'tgw',
      transitGatewayId: 'tgw-abc',
      routeTableId: 'tgw-rtb-abc',
    },
    cgwBgpAsn: TGW1_VPN_CONFIG.cgwBgpAsn,
    awsBgpAsn: TGW1_VPN_CONFIG.awsBgpAsn,
    tunnel1InsideCidr: TGW1_VPN_CONFIG.tunnel1InsideCidr,
    tunnel2InsideCidr: TGW1_VPN_CONFIG.tunnel2InsideCidr,
  });
  const template = Template.fromStack(stack);

  test('creates a VPN connection attached to the TGW', () => {
    template.hasResourceProperties('AWS::EC2::VPNConnection', {
      Type: 'ipsec.1',
      StaticRoutesOnly: false,
      TransitGatewayId: 'tgw-abc',
    });
  });

  test('does not create a Cloud WAN Site-to-Site VPN attachment', () => {
    template.resourceCountIs(
      'AWS::NetworkManager::SiteToSiteVpnAttachment',
      0,
    );
  });

  test('Customer Gateway uses the TGW-side ASN configuration', () => {
    template.hasResourceProperties('AWS::EC2::CustomerGateway', {
      BgpAsn: TGW1_VPN_CONFIG.cgwBgpAsn,
    });
  });
});
