import * as networkmanager from 'aws-cdk-lib/aws-networkmanager';
import { Construct } from 'constructs';
import {
  CORE_NETWORK_CONFIG,
  cloudWanSegment,
  cloudWanTagKey,
} from '../network-config';

export interface CoreNetworkProps {
  /** Cloud WAN Edge Location のリージョン */
  readonly region: string;
}

export class CoreNetwork extends Construct {
  public readonly coreNetworkId: string;
  public readonly coreNetworkArn: string;
  public readonly globalNetworkId: string;

  constructor(scope: Construct, id: string, props: CoreNetworkProps) {
    super(scope, id);

    const globalNetwork = new networkmanager.CfnGlobalNetwork(
      this,
      'GlobalNetwork',
      {
        description: 'Cloud WAN Global Network',
      },
    );

    const coreNetwork = new networkmanager.CfnCoreNetwork(this, 'CoreNetwork', {
      description: 'Cloud WAN Core Network',
      globalNetworkId: globalNetwork.attrId,
      policyDocument: {
        version: '2021.12',
        'core-network-configuration': {
          'vpn-ecmp-support': true,
          'inside-cidr-blocks': CORE_NETWORK_CONFIG.insideCidrBlocks,
          'asn-ranges': CORE_NETWORK_CONFIG.asnRanges,
          'edge-locations': [
            {
              location: props.region,
              asn: CORE_NETWORK_CONFIG.edgeAsn,
            },
          ],
        },
        segments: [
          {
            name: cloudWanSegment.Prod,
            'require-attachment-acceptance': false,
            'edge-locations': [props.region],
          },
        ],
        'attachment-policies': [
          {
            'rule-number': 100,
            description: `attachment segment ${cloudWanSegment.Prod}`,
            'condition-logic': 'or',
            conditions: [
              {
                type: 'tag-value',
                operator: 'equals',
                key: cloudWanTagKey.Segment,
                value: cloudWanSegment.Prod,
              },
            ],
            action: {
              'association-method': 'constant',
              segment: cloudWanSegment.Prod,
            },
          },
        ],
      },
    });

    this.globalNetworkId = globalNetwork.attrId;
    this.coreNetworkId = coreNetwork.attrCoreNetworkId;
    this.coreNetworkArn = coreNetwork.attrCoreNetworkArn;
  }
}
