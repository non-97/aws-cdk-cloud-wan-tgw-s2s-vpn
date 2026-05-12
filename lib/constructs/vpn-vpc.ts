import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as networkmanager from 'aws-cdk-lib/aws-networkmanager';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import * as fs from 'fs';
import { Construct } from 'constructs';
import {
  RFC1918_CIDRS,
  VPN_COMMON_CONFIG,
  cloudWanTagKey,
  OnPremSiteConfig,
} from '../network-config';

/** VPN attach 先 */
export type VpnAttachmentTarget =
  | {
      readonly kind: 'cloudWan';
      readonly coreNetworkId: string;
      readonly segmentTag: string;
    }
  | {
      readonly kind: 'tgw';
      readonly transitGatewayId: string;
      readonly routeTableId: string;
    };

export interface VpnVpcProps {
  /** VPC CIDR ブロック */
  readonly vpcCidr: string;
  /** Site-to-Site VPN の attach 先 */
  readonly attachment: VpnAttachmentTarget;
  /** Customer Gateway 側 BGP ASN */
  readonly cgwBgpAsn: number;
  /** AWS 側 BGP ASN (Cloud WAN edge / TGW Amazon side) */
  readonly awsBgpAsn: number;
  /** Tunnel 1 inside CIDR (/30) */
  readonly tunnel1InsideCidr: string;
  /** Tunnel 2 inside CIDR (/30) */
  readonly tunnel2InsideCidr: string;
  /**
   * EIC Endpoint を作成するか。EC2 Instance Connect Endpoint は
   * アカウント・リージョン あたり 5 個までの hard quota があるため、
   * 6 個目以降の VPC では false を指定して回避する。
   *
   * @default true
   */
  readonly createEicEndpoint?: boolean;
  /**
   * Network Manager の Global Network ID。Site / Device / Link 等の
   * 擬似オンプレ拠点メタデータを登録する場合に指定する。
   *
   * @default - Site/Device/Link を作成しない
   */
  readonly globalNetworkId?: string;
  /**
   * 擬似オンプレ拠点のメタデータ。`globalNetworkId` と併せて指定する。
   *
   * @default - Site/Device/Link を作成しない
   */
  readonly onPremSite?: OnPremSiteConfig;
}

export class VpnVpc extends Construct {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: VpnVpcProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr),
      maxAzs: 1,
      natGateways: 0,
      restrictDefaultSecurityGroup: false,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
    this.vpc = vpc;

    const publicSubnet = vpc.selectSubnets({ subnetGroupName: 'Public' })
      .subnets[0];
    const privateSubnet = vpc.selectSubnets({ subnetGroupName: 'Private' })
      .subnets[0];

    const vpnSg = new ec2.SecurityGroup(this, 'VpnSg', {
      vpc,
      description: 'for VPN Router',
    });
    vpnSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(500));
    vpnSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(4500));
    for (const cidr of RFC1918_CIDRS) {
      vpnSg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.allTraffic());
    }

    const ec2Sg = new ec2.SecurityGroup(this, 'Ec2Sg', {
      vpc,
      description: 'for EC2 instance',
    });
    for (const cidr of RFC1918_CIDRS) {
      ec2Sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.allTraffic());
    }

    const vpnEni0 = new ec2.CfnNetworkInterface(this, 'VpnEni0', {
      description: 'eth0',
      sourceDestCheck: false,
      subnetId: publicSubnet.subnetId,
      groupSet: [vpnSg.securityGroupId],
    });

    const vpnEni1 = new ec2.CfnNetworkInterface(this, 'VpnEni1', {
      description: 'eth1',
      sourceDestCheck: false,
      subnetId: privateSubnet.subnetId,
      groupSet: [vpnSg.securityGroupId],
    });

    const vpnEip = new ec2.CfnEIP(this, 'VpnEip', { domain: 'vpc' });

    const cgw = new ec2.CfnCustomerGateway(this, 'CustomerGateway', {
      type: 'ipsec.1',
      bgpAsn: props.cgwBgpAsn,
      ipAddress: vpnEip.ref,
    });

    const vpnActivityLogGroup = new logs.LogGroup(this, 'VpnActivityLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const vpnBgpLogGroup = new logs.LogGroup(this, 'VpnBgpLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const tunnelOptions = {
      ikeVersions: [{ value: 'ikev2' }],
      phase1EncryptionAlgorithms: [
        { value: 'AES256' },
        { value: 'AES128-GCM-16' },
        { value: 'AES256-GCM-16' },
      ],
      phase1IntegrityAlgorithms: [
        { value: 'SHA2-256' },
        { value: 'SHA2-384' },
        { value: 'SHA2-512' },
      ],
      phase1DhGroupNumbers: [
        { value: 14 },
        { value: 15 },
        { value: 16 },
        { value: 19 },
        { value: 20 },
        { value: 21 },
        { value: 22 },
        { value: 23 },
        { value: 24 },
      ],
      phase2EncryptionAlgorithms: [
        { value: 'AES256' },
        { value: 'AES128-GCM-16' },
        { value: 'AES256-GCM-16' },
      ],
      phase2IntegrityAlgorithms: [
        { value: 'SHA2-256' },
        { value: 'SHA2-384' },
        { value: 'SHA2-512' },
      ],
      phase2DhGroupNumbers: [
        { value: 14 },
        { value: 15 },
        { value: 16 },
        { value: 19 },
        { value: 20 },
        { value: 21 },
        { value: 22 },
        { value: 23 },
        { value: 24 },
      ],
      dpdTimeoutAction: 'clear',
      startupAction: 'add',
      logOptions: {
        cloudwatchLogOptions: {
          logEnabled: true,
          logGroupArn: cdk.Arn.format(
            {
              service: 'logs',
              resource: 'log-group',
              resourceName: vpnActivityLogGroup.logGroupName,
              arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            },
            stack,
          ),
          logOutputFormat: 'json',
          bgpLogEnabled: true,
          bgpLogGroupArn: cdk.Arn.format(
            {
              service: 'logs',
              resource: 'log-group',
              resourceName: vpnBgpLogGroup.logGroupName,
              arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            },
            stack,
          ),
          bgpLogOutputFormat: 'json',
        },
      },
    };

    const vpnConn = new ec2.CfnVPNConnection(this, 'VpnConnection', {
      type: 'ipsec.1',
      staticRoutesOnly: false,
      customerGatewayId: cgw.ref,
      transitGatewayId:
        props.attachment.kind === 'tgw'
          ? props.attachment.transitGatewayId
          : undefined,
      vpnTunnelOptionsSpecifications: [
        {
          preSharedKey: VPN_COMMON_CONFIG.preSharedKey,
          tunnelInsideCidr: props.tunnel1InsideCidr,
          ...tunnelOptions,
        },
        {
          preSharedKey: VPN_COMMON_CONFIG.preSharedKey,
          tunnelInsideCidr: props.tunnel2InsideCidr,
          ...tunnelOptions,
        },
      ],
    });

    const userDataScript = fs.readFileSync(
      path.join(__dirname, '../../src/ec2/vpn-router-userdata.sh'),
      'utf-8',
    );
    const userDataWithVars = cdk.Fn.sub(userDataScript, {
      VPNID: vpnConn.ref,
      REGION: cdk.Aws.REGION,
      VPC_CIDR: props.vpcCidr,
      CGW_ASN: props.cgwBgpAsn.toString(),
      AWS_ASN: props.awsBgpAsn.toString(),
    });

    const vpnRouterRole = new iam.Role(this, 'VpnRouterRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      inlinePolicies: {
        vpnRouterPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['ec2:DescribeVpnConnections', 'ec2:DescribeInstances'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    const vpnRouterAmiId = ssm.StringParameter.valueForStringParameter(
      this,
      '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64',
    );
    new ec2.CfnInstance(this, 'VpnRouter', {
      imageId: vpnRouterAmiId,
      instanceType: 't3.small',
      iamInstanceProfile: new iam.CfnInstanceProfile(this, 'VpnRouterProfile', {
        roles: [vpnRouterRole.roleName],
      }).ref,
      networkInterfaces: [
        { networkInterfaceId: vpnEni0.ref, deviceIndex: '0' },
        { networkInterfaceId: vpnEni1.ref, deviceIndex: '1' },
      ],
      userData: cdk.Fn.base64(userDataWithVars),
    });

    new ec2.CfnEIPAssociation(this, 'VpnEipAssoc', {
      allocationId: vpnEip.attrAllocationId,
      networkInterfaceId: vpnEni0.attrId,
    });

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

    if (props.createEicEndpoint ?? true) {
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
    }

    new ec2.CfnRoute(this, 'PrivateSubnetDefaultRoute', {
      routeTableId: privateSubnet.routeTable.routeTableId,
      destinationCidrBlock: '0.0.0.0/0',
      networkInterfaceId: vpnEni1.attrId,
    });

    // Network Manager の Site / Device / Link / CustomerGatewayAssociation を
    // 擬似オンプレ拠点として登録する (経路制御には影響せずトポロジ可視化目的)。
    if (props.globalNetworkId && props.onPremSite) {
      const site = new networkmanager.CfnSite(this, 'Site', {
        globalNetworkId: props.globalNetworkId,
        description: props.onPremSite.siteDescription,
        location: {
          address: props.onPremSite.siteAddress,
          latitude: props.onPremSite.siteLatitude,
          longitude: props.onPremSite.siteLongitude,
        },
      });

      const device = new networkmanager.CfnDevice(this, 'Device', {
        globalNetworkId: props.globalNetworkId,
        siteId: site.attrSiteId,
        description: props.onPremSite.deviceDescription,
        vendor: props.onPremSite.deviceVendor,
        model: props.onPremSite.deviceModel,
        type: props.onPremSite.deviceType,
      });

      const link = new networkmanager.CfnLink(this, 'Link', {
        globalNetworkId: props.globalNetworkId,
        siteId: site.attrSiteId,
        description: props.onPremSite.linkDescription,
        type: props.onPremSite.linkType,
        provider: props.onPremSite.linkProvider,
        bandwidth: {
          uploadSpeed: props.onPremSite.linkUploadSpeed,
          downloadSpeed: props.onPremSite.linkDownloadSpeed,
        },
      });

      new networkmanager.CfnLinkAssociation(this, 'DeviceLinkAssociation', {
        globalNetworkId: props.globalNetworkId,
        deviceId: device.attrDeviceId,
        linkId: link.attrLinkId,
      });

      const cgwAssoc = new networkmanager.CfnCustomerGatewayAssociation(
        this,
        'CustomerGatewayAssociation',
        {
          globalNetworkId: props.globalNetworkId,
          customerGatewayArn: cdk.Arn.format(
            {
              service: 'ec2',
              resource: 'customer-gateway',
              resourceName: cgw.ref,
            },
            stack,
          ),
          deviceId: device.attrDeviceId,
          linkId: link.attrLinkId,
        },
      );
      // CustomerGatewayAssociation は CGW が VPN connection に bind されてから
      // 実行する必要があるため、VPN connection への依存を明示する。
      cgwAssoc.node.addDependency(vpnConn);
    }

    if (props.attachment.kind === 'cloudWan') {
      const cloudWan = props.attachment;
      new networkmanager.CfnSiteToSiteVpnAttachment(
        this,
        'SiteToSiteVpnAttachment',
        {
          coreNetworkId: cloudWan.coreNetworkId,
          vpnConnectionArn: cdk.Arn.format(
            {
              service: 'ec2',
              resource: 'vpn-connection',
              resourceName: vpnConn.ref,
            },
            stack,
          ),
          tags: [
            { key: cloudWanTagKey.Segment, value: cloudWan.segmentTag },
          ],
        },
      );
    } else {
      const tgw = props.attachment;

      // VPN attachment ID は CfnVPNConnection から取得できないため
      // AwsCustomResource で describeTransitGatewayAttachments を呼ぶ。
      const describeVpnAttachment = new AwsCustomResource(
        this,
        'DescribeVpnAttachment',
        {
          onCreate: {
            service: 'EC2',
            action: 'describeTransitGatewayAttachments',
            parameters: {
              Filters: [
                { Name: 'resource-id', Values: [vpnConn.ref] },
                { Name: 'resource-type', Values: ['vpn'] },
              ],
            },
            physicalResourceId: PhysicalResourceId.of(vpnConn.ref),
          },
          onUpdate: {
            service: 'EC2',
            action: 'describeTransitGatewayAttachments',
            parameters: {
              Filters: [
                { Name: 'resource-id', Values: [vpnConn.ref] },
                { Name: 'resource-type', Values: ['vpn'] },
              ],
            },
            physicalResourceId: PhysicalResourceId.of(vpnConn.ref),
          },
          policy: AwsCustomResourcePolicy.fromSdkCalls({
            resources: AwsCustomResourcePolicy.ANY_RESOURCE,
          }),
        },
      );
      describeVpnAttachment.node.addDependency(vpnConn);

      const vpnAttachmentId = describeVpnAttachment.getResponseField(
        'TransitGatewayAttachments.0.TransitGatewayAttachmentId',
      );

      new ec2.CfnTransitGatewayRouteTableAssociation(
        this,
        'VpnTgwRtAssociation',
        {
          transitGatewayRouteTableId: tgw.routeTableId,
          transitGatewayAttachmentId: vpnAttachmentId,
        },
      );

      new ec2.CfnTransitGatewayRouteTablePropagation(
        this,
        'VpnTgwRtPropagation',
        {
          transitGatewayRouteTableId: tgw.routeTableId,
          transitGatewayAttachmentId: vpnAttachmentId,
        },
      );
    }
  }
}
