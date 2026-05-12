import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CoreNetwork } from '../../lib/constructs';
import {
  cloudWanSegment,
  cloudWanTagKey,
  CORE_NETWORK_CONFIG,
} from '../../lib/network-config';

describe('CoreNetwork', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  new CoreNetwork(stack, 'CoreNetwork', { region: 'ap-northeast-1' });
  const template = Template.fromStack(stack);

  test('creates a Global Network and a Core Network', () => {
    template.resourceCountIs('AWS::NetworkManager::GlobalNetwork', 1);
    template.resourceCountIs('AWS::NetworkManager::CoreNetwork', 1);
  });

  test('policy has prod segment with the configured edge ASN and inside CIDR', () => {
    template.hasResourceProperties('AWS::NetworkManager::CoreNetwork', {
      PolicyDocument: Match.objectLike({
        'core-network-configuration': Match.objectLike({
          'asn-ranges': CORE_NETWORK_CONFIG.asnRanges,
          'inside-cidr-blocks': CORE_NETWORK_CONFIG.insideCidrBlocks,
          'edge-locations': [
            { location: 'ap-northeast-1', asn: CORE_NETWORK_CONFIG.edgeAsn },
          ],
        }),
        segments: [
          Match.objectLike({
            name: cloudWanSegment.Prod,
            'edge-locations': ['ap-northeast-1'],
          }),
        ],
        'attachment-policies': Match.arrayWith([
          Match.objectLike({
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
          }),
        ]),
      }),
    });
  });
});
