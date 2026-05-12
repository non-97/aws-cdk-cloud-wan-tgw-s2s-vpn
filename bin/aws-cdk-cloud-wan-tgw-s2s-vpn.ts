#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AwsCdkCloudWanTgwS2SVpnStack } from '../lib/aws-cdk-cloud-wan-tgw-s2s-vpn-stack';

const app = new cdk.App();
new AwsCdkCloudWanTgwS2SVpnStack(app, 'AwsCdkCloudWanTgwS2SVpnStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});
