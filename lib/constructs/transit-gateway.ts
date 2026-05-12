import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
  PhysicalResourceIdReference,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface TransitGatewayProps {
  /** TGW Amazon side ASN */
  readonly amazonSideAsn: number;
}

export class TransitGateway extends Construct {
  public readonly transitGateway: ec2.CfnTransitGateway;
  public readonly transitGatewayId: string;
  /** 明示的に作成する TGW Route Table の ID。各 attachment はこの RT に association/propagation する。 */
  public readonly routeTableId: string;
  /**
   * TGW Policy Table ID。
   * AWS::EC2::TransitGatewayPolicyTable は CFN リソース化されていないため
   * AwsCustomResource 経由で createTransitGatewayPolicyTable を呼ぶ。
   * Cloud WAN <-> TGW peering attachment への associate に必要。
   */
  public readonly policyTableId: string;

  constructor(scope: Construct, id: string, props: TransitGatewayProps) {
    super(scope, id);

    const tgw = new ec2.CfnTransitGateway(this, 'TransitGateway', {
      amazonSideAsn: props.amazonSideAsn,
      defaultRouteTableAssociation: 'disable',
      defaultRouteTablePropagation: 'disable',
      autoAcceptSharedAttachments: 'disable',
      dnsSupport: 'enable',
      vpnEcmpSupport: 'enable',
      description: 'Transit Gateway',
    });

    const routeTable = new ec2.CfnTransitGatewayRouteTable(this, 'RouteTable', {
      transitGatewayId: tgw.ref,
    });

    const policyTable = new AwsCustomResource(this, 'PolicyTable', {
      onCreate: {
        service: 'EC2',
        action: 'createTransitGatewayPolicyTable',
        parameters: { TransitGatewayId: tgw.ref },
        physicalResourceId: PhysicalResourceId.fromResponse(
          'TransitGatewayPolicyTable.TransitGatewayPolicyTableId',
        ),
      },
      onDelete: {
        service: 'EC2',
        action: 'deleteTransitGatewayPolicyTable',
        parameters: {
          TransitGatewayPolicyTableId: new PhysicalResourceIdReference(),
        },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });
    policyTable.node.addDependency(tgw);

    this.transitGateway = tgw;
    this.transitGatewayId = tgw.ref;
    this.routeTableId = routeTable.ref;
    this.policyTableId = policyTable.getResponseField(
      'TransitGatewayPolicyTable.TransitGatewayPolicyTableId',
    );
  }
}
