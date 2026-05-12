import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as networkmanager from 'aws-cdk-lib/aws-networkmanager';
import { Construct } from 'constructs';
import { RFC1918_CIDRS, cloudWanTagKey } from '../network-config';

/** VPC の attach 先 */
export type VpcAttachmentTarget =
  | {
      readonly kind: 'cloudWan';
      readonly coreNetworkId: string;
      readonly coreNetworkArn: string;
      readonly segmentTag: string;
    }
  | {
      readonly kind: 'tgw';
      readonly transitGatewayId: string;
      readonly routeTableId: string;
    };

export interface PrivateVpcProps {
  /** VPC CIDR ブロック */
  readonly vpcCidr: string;
  /** VPC の attach 先 (Cloud WAN / TGW) */
  readonly attachment: VpcAttachmentTarget;
}

export class PrivateVpc extends Construct {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: PrivateVpcProps) {
    super(scope, id);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr),
      maxAzs: 1,
      natGateways: 0,
      restrictDefaultSecurityGroup: false,
      subnetConfiguration: [
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
        {
          name: 'Attachment',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
    this.vpc = vpc;

    const privateSubnet = vpc.selectSubnets({ subnetGroupName: 'Private' })
      .subnets[0];
    const attachmentSubnet = vpc.selectSubnets({ subnetGroupName: 'Attachment' })
      .subnets[0];

    const ec2Sg = new ec2.SecurityGroup(this, 'Ec2Sg', {
      vpc,
      description: 'for EC2 instance',
    });
    for (const cidr of RFC1918_CIDRS) {
      ec2Sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.allTraffic());
    }

    new ec2.Instance(this, 'Instance', {
      vpc,
      vpcSubnets: { subnets: [privateSubnet] },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64',
      ),
      securityGroup: ec2Sg,
      ssmSessionPermissions: true,
    });

    const eicSg = new ec2.SecurityGroup(this, 'EicSg', {
      vpc,
      description: 'for EIC Endpoint',
      allowAllOutbound: false,
    });
    eicSg.addEgressRule(ec2.Peer.ipv4(props.vpcCidr), ec2.Port.tcp(22));

    new ec2.CfnInstanceConnectEndpoint(this, 'EicEndpoint', {
      subnetId: privateSubnet.subnetId,
      securityGroupIds: [eicSg.securityGroupId],
    });

    if (props.attachment.kind === 'cloudWan') {
      const cloudWan = props.attachment;
      const attachment = new networkmanager.CfnVpcAttachment(
        this,
        'CloudWanAttachment',
        {
          coreNetworkId: cloudWan.coreNetworkId,
          vpcArn: vpc.vpcArn,
          subnetArns: [
            cdk.Arn.format(
              {
                service: 'ec2',
                resource: 'subnet',
                resourceName: attachmentSubnet.subnetId,
              },
              cdk.Stack.of(this),
            ),
          ],
          tags: [
            { key: cloudWanTagKey.Segment, value: cloudWan.segmentTag },
          ],
        },
      );

      const route = new ec2.CfnRoute(this, 'PrivateSubnetDefaultRoute', {
        routeTableId: privateSubnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        coreNetworkArn: cloudWan.coreNetworkArn,
      });
      route.addDependency(attachment);
    } else {
      const tgw = props.attachment;
      const attachment = new ec2.CfnTransitGatewayVpcAttachment(
        this,
        'TgwAttachment',
        {
          transitGatewayId: tgw.transitGatewayId,
          vpcId: vpc.vpcId,
          subnetIds: [attachmentSubnet.subnetId],
        },
      );

      new ec2.CfnTransitGatewayRouteTableAssociation(
        this,
        'TgwRtAssociation',
        {
          transitGatewayRouteTableId: tgw.routeTableId,
          transitGatewayAttachmentId: attachment.attrId,
        },
      );

      new ec2.CfnTransitGatewayRouteTablePropagation(
        this,
        'TgwRtPropagation',
        {
          transitGatewayRouteTableId: tgw.routeTableId,
          transitGatewayAttachmentId: attachment.attrId,
        },
      );

      const route = new ec2.CfnRoute(this, 'PrivateSubnetDefaultRoute', {
        routeTableId: privateSubnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        transitGatewayId: tgw.transitGatewayId,
      });
      route.addDependency(attachment);
    }
  }
}
