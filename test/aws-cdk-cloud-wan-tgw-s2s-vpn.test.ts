import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsCdkCloudWanTgwS2SVpnStack } from '../lib/aws-cdk-cloud-wan-tgw-s2s-vpn-stack';
import {
  cloudWanSegment,
  cloudWanTagKey,
  CLOUD_WAN_VPN_CONFIG,
  TGW1_VPN_CONFIG,
  TGW2_VPN_CONFIG,
  TGW1_CONFIG,
  TGW2_CONFIG,
  NETWORK_CONFIG,
} from '../lib/network-config';

describe('AwsCdkCloudWanTgwS2SVpnStack', () => {
  const app = new cdk.App();
  const stack = new AwsCdkCloudWanTgwS2SVpnStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  const template = Template.fromStack(stack);

  test('creates Cloud WAN Core Network', () => {
    template.resourceCountIs('AWS::NetworkManager::GlobalNetwork', 1);
    template.resourceCountIs('AWS::NetworkManager::CoreNetwork', 1);
  });

  test('creates two Transit Gateways with distinct ASNs and default RT disabled', () => {
    template.resourceCountIs('AWS::EC2::TransitGateway', 2);
    template.hasResourceProperties('AWS::EC2::TransitGateway', {
      AmazonSideAsn: TGW1_CONFIG.amazonSideAsn,
      DefaultRouteTableAssociation: 'disable',
      DefaultRouteTablePropagation: 'disable',
    });
    template.hasResourceProperties('AWS::EC2::TransitGateway', {
      AmazonSideAsn: TGW2_CONFIG.amazonSideAsn,
      DefaultRouteTableAssociation: 'disable',
      DefaultRouteTablePropagation: 'disable',
    });
  });

  test('creates one explicit TGW Route Table per Transit Gateway', () => {
    template.resourceCountIs('AWS::EC2::TransitGatewayRouteTable', 2);
  });

  test('creates six VPCs with expected CIDRs', () => {
    template.resourceCountIs('AWS::EC2::VPC', 6);
    for (const cidr of [
      NETWORK_CONFIG.cloudWanPrivate.vpcCidr,
      NETWORK_CONFIG.cloudWanVpn.vpcCidr,
      NETWORK_CONFIG.tgwPrivate1.vpcCidr,
      NETWORK_CONFIG.tgwVpn1.vpcCidr,
      NETWORK_CONFIG.tgwPrivate2.vpcCidr,
      NETWORK_CONFIG.tgwVpn2.vpcCidr,
    ]) {
      template.hasResourceProperties('AWS::EC2::VPC', { CidrBlock: cidr });
    }
  });

  test('creates Cloud WAN attachments (1 VPC + 1 S2S VPN) tagged with prod segment', () => {
    template.resourceCountIs('AWS::NetworkManager::VpcAttachment', 1);
    template.hasResourceProperties('AWS::NetworkManager::VpcAttachment', {
      Tags: Match.arrayWith([
        { Key: cloudWanTagKey.Segment, Value: cloudWanSegment.Prod },
      ]),
    });

    template.resourceCountIs('AWS::NetworkManager::SiteToSiteVpnAttachment', 1);
    template.hasResourceProperties(
      'AWS::NetworkManager::SiteToSiteVpnAttachment',
      {
        Tags: Match.arrayWith([
          { Key: cloudWanTagKey.Segment, Value: cloudWanSegment.Prod },
        ]),
      },
    );
  });

  test('creates two TGW VPC attachments with association and propagation', () => {
    template.resourceCountIs('AWS::EC2::TransitGatewayVpcAttachment', 2);
    // VPC × 2 + VPN × 2 = 4 association、4 propagation
    template.resourceCountIs(
      'AWS::EC2::TransitGatewayRouteTableAssociation',
      4,
    );
    template.resourceCountIs(
      'AWS::EC2::TransitGatewayRouteTablePropagation',
      4,
    );
  });

  test('creates three VPN connections (one Cloud WAN, two TGW)', () => {
    template.resourceCountIs('AWS::EC2::VPNConnection', 3);
  });

  test('creates three Customer Gateways with distinct ASNs', () => {
    template.resourceCountIs('AWS::EC2::CustomerGateway', 3);
    for (const asn of [
      CLOUD_WAN_VPN_CONFIG.cgwBgpAsn,
      TGW1_VPN_CONFIG.cgwBgpAsn,
      TGW2_VPN_CONFIG.cgwBgpAsn,
    ]) {
      template.hasResourceProperties('AWS::EC2::CustomerGateway', {
        BgpAsn: asn,
      });
    }
  });

  test('registers each TGW to the Cloud WAN Global Network', () => {
    template.resourceCountIs(
      'AWS::NetworkManager::TransitGatewayRegistration',
      2,
    );
  });

  test('creates one Cloud WAN <-> TGW peering per Transit Gateway', () => {
    template.resourceCountIs('AWS::NetworkManager::TransitGatewayPeering', 2);
  });

  test('attaches each TGW route table to prod segment', () => {
    template.resourceCountIs(
      'AWS::NetworkManager::TransitGatewayRouteTableAttachment',
      2,
    );
  });

  test('creates EIC Endpoint for 5 of 6 VPCs (VPN VPC 3 omitted due to account quota of 5)', () => {
    template.resourceCountIs('AWS::EC2::InstanceConnectEndpoint', 5);
  });

  test('creates worker EC2 + VPN router instances (6 + 3 = 9)', () => {
    template.resourceCountIs('AWS::EC2::Instance', 9);
  });

  test('registers 3 mock on-prem sites/devices/links to Network Manager', () => {
    template.resourceCountIs('AWS::NetworkManager::Site', 3);
    template.resourceCountIs('AWS::NetworkManager::Device', 3);
    template.resourceCountIs('AWS::NetworkManager::Link', 3);
    template.resourceCountIs('AWS::NetworkManager::LinkAssociation', 3);
    template.resourceCountIs(
      'AWS::NetworkManager::CustomerGatewayAssociation',
      3,
    );
    template.hasResourceProperties('AWS::NetworkManager::Device', {
      Vendor: 'Libreswan Project',
      Model: 'Libreswan + FRR on Amazon Linux 2023',
      Type: 'ipsec-router',
    });
  });
});
