import * as cdk from "aws-cdk-lib/core";
import * as networkmanager from "aws-cdk-lib/aws-networkmanager";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { CoreNetwork, TransitGateway, PrivateVpc, VpnVpc } from "./constructs";
import {
  NETWORK_CONFIG,
  CLOUD_WAN_VPN_CONFIG,
  TGW1_CONFIG,
  TGW1_VPN_CONFIG,
  TGW2_CONFIG,
  TGW2_VPN_CONFIG,
  cloudWanSegment,
  cloudWanTagKey,
} from "./network-config";

export class AwsCdkCloudWanTgwS2SVpnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const coreNetwork = new CoreNetwork(this, "CoreNetwork", {
      region: this.region,
    });

    const tgw1 = new TransitGateway(this, "TransitGateway1", {
      amazonSideAsn: TGW1_CONFIG.amazonSideAsn,
    });
    const tgw2 = new TransitGateway(this, "TransitGateway2", {
      amazonSideAsn: TGW2_CONFIG.amazonSideAsn,
    });

    // Cloud WAN 直 attach の VPC
    new PrivateVpc(this, "CloudWanPrivateVpc", {
      vpcCidr: NETWORK_CONFIG.cloudWanPrivate.vpcCidr,
      attachment: {
        kind: "cloudWan",
        coreNetworkId: coreNetwork.coreNetworkId,
        coreNetworkArn: coreNetwork.coreNetworkArn,
        segmentTag: cloudWanSegment.Prod,
      },
    });

    new VpnVpc(this, "CloudWanVpnVpc", {
      vpcCidr: NETWORK_CONFIG.cloudWanVpn.vpcCidr,
      attachment: {
        kind: "cloudWan",
        coreNetworkId: coreNetwork.coreNetworkId,
        segmentTag: cloudWanSegment.Prod,
      },
      cgwBgpAsn: CLOUD_WAN_VPN_CONFIG.cgwBgpAsn,
      awsBgpAsn: CLOUD_WAN_VPN_CONFIG.awsBgpAsn,
      tunnel1InsideCidr: CLOUD_WAN_VPN_CONFIG.tunnel1InsideCidr,
      tunnel2InsideCidr: CLOUD_WAN_VPN_CONFIG.tunnel2InsideCidr,
    });

    // TGW1 配下の VPC
    new PrivateVpc(this, "TgwPrivateVpc1", {
      vpcCidr: NETWORK_CONFIG.tgwPrivate1.vpcCidr,
      attachment: {
        kind: "tgw",
        transitGatewayId: tgw1.transitGatewayId,
        routeTableId: tgw1.routeTableId,
      },
    });

    new VpnVpc(this, "TgwVpnVpc1", {
      vpcCidr: NETWORK_CONFIG.tgwVpn1.vpcCidr,
      attachment: {
        kind: "tgw",
        transitGatewayId: tgw1.transitGatewayId,
        routeTableId: tgw1.routeTableId,
      },
      cgwBgpAsn: TGW1_VPN_CONFIG.cgwBgpAsn,
      awsBgpAsn: TGW1_VPN_CONFIG.awsBgpAsn,
      tunnel1InsideCidr: TGW1_VPN_CONFIG.tunnel1InsideCidr,
      tunnel2InsideCidr: TGW1_VPN_CONFIG.tunnel2InsideCidr,
    });

    // TGW2 配下の VPC
    new PrivateVpc(this, "TgwPrivateVpc2", {
      vpcCidr: NETWORK_CONFIG.tgwPrivate2.vpcCidr,
      attachment: {
        kind: "tgw",
        transitGatewayId: tgw2.transitGatewayId,
        routeTableId: tgw2.routeTableId,
      },
    });

    // EIC Endpoint はアカウント・リージョン あたり 5 個までの hard quota のため
    // 6 個目となる VPN VPC 3 では EIC を作成しない。
    // 代替アクセス: VPN router は SSM Session Manager (Public subnet + ssmSessionPermissions)、
    // Private subnet の検証 EC2 は Cloud WAN/TGW2 経由で他 EIC あり VPC から接続。
    new VpnVpc(this, "TgwVpnVpc2", {
      vpcCidr: NETWORK_CONFIG.tgwVpn2.vpcCidr,
      attachment: {
        kind: "tgw",
        transitGatewayId: tgw2.transitGatewayId,
        routeTableId: tgw2.routeTableId,
      },
      cgwBgpAsn: TGW2_VPN_CONFIG.cgwBgpAsn,
      awsBgpAsn: TGW2_VPN_CONFIG.awsBgpAsn,
      tunnel1InsideCidr: TGW2_VPN_CONFIG.tunnel1InsideCidr,
      tunnel2InsideCidr: TGW2_VPN_CONFIG.tunnel2InsideCidr,
      createEicEndpoint: false,
    });

    // 各 TGW を Cloud WAN core network に peering する処理を共通化。
    const tgws = [
      { idPrefix: "Tgw1", tgw: tgw1 },
      { idPrefix: "Tgw2", tgw: tgw2 },
    ];

    for (const { idPrefix, tgw } of tgws) {
      const tgwArn = cdk.Arn.format(
        {
          service: "ec2",
          resource: "transit-gateway",
          resourceName: tgw.transitGatewayId,
        },
        this
      );

      // TGW を Cloud WAN Global Network に登録。
      const registration = new networkmanager.CfnTransitGatewayRegistration(
        this,
        `${idPrefix}Registration`,
        {
          globalNetworkId: coreNetwork.globalNetworkId,
          transitGatewayArn: tgwArn,
        }
      );

      // Cloud WAN <-> TGW peering。
      const peering = new networkmanager.CfnTransitGatewayPeering(
        this,
        `${idPrefix}Peering`,
        {
          coreNetworkId: coreNetwork.coreNetworkId,
          transitGatewayArn: tgwArn,
          tags: [{ key: cloudWanTagKey.Segment, value: cloudWanSegment.Prod }],
        }
      );
      peering.node.addDependency(registration);

      // peering attachment に TGW Policy Table を associate。
      const associatePolicyTable = new AwsCustomResource(
        this,
        `${idPrefix}AssociatePolicyTable`,
        {
          onCreate: {
            service: "EC2",
            action: "associateTransitGatewayPolicyTable",
            parameters: {
              TransitGatewayPolicyTableId: tgw.policyTableId,
              TransitGatewayAttachmentId:
                peering.attrTransitGatewayPeeringAttachmentId,
            },
            physicalResourceId: PhysicalResourceId.of(
              peering.attrTransitGatewayPeeringAttachmentId
            ),
          },
          onDelete: {
            service: "EC2",
            action: "disassociateTransitGatewayPolicyTable",
            parameters: {
              TransitGatewayPolicyTableId: tgw.policyTableId,
              TransitGatewayAttachmentId:
                peering.attrTransitGatewayPeeringAttachmentId,
            },
          },
          policy: AwsCustomResourcePolicy.fromSdkCalls({
            resources: AwsCustomResourcePolicy.ANY_RESOURCE,
          }),
        }
      );
      associatePolicyTable.node.addDependency(peering);

      // TGW route table を Cloud WAN prod segment にマップ。
      const rtAttachment =
        new networkmanager.CfnTransitGatewayRouteTableAttachment(
          this,
          `${idPrefix}RouteTableAttachment`,
          {
            peeringId: peering.attrPeeringId,
            transitGatewayRouteTableArn: cdk.Arn.format(
              {
                service: "ec2",
                resource: "transit-gateway-route-table",
                resourceName: tgw.routeTableId,
              },
              this
            ),
            tags: [
              { key: cloudWanTagKey.Segment, value: cloudWanSegment.Prod },
            ],
          }
        );
      rtAttachment.node.addDependency(associatePolicyTable);
    }
  }
}
