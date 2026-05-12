/**
 * ネットワーク設定の一元管理。
 * 全 CIDR / IP / ASN / セグメント名をここで定義し、Stack / Construct に Props 経由で注入する。
 */

/** RFC1918 プライベートアドレス帯 */
export const RFC1918_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
] as const;

/** Cloud WAN Attachment タグキー */
export const cloudWanTagKey = {
  Segment: 'cloudwan-seg',
} as const;

/** Cloud WAN セグメント名 */
export const cloudWanSegment = {
  Prod: 'prod',
} as const;

/** Cloud WAN Core Network 設定 */
export const CORE_NETWORK_CONFIG = {
  insideCidrBlocks: ['192.168.0.0/16'],
  asnRanges: ['64512-64555'],
  edgeAsn: 64512,
} as const;

/** Transit Gateway 1 設定 */
export const TGW1_CONFIG = {
  amazonSideAsn: 64513,
} as const;

/** Transit Gateway 2 設定 */
export const TGW2_CONFIG = {
  amazonSideAsn: 64514,
} as const;

/** VPN 共通設定 */
export const VPN_COMMON_CONFIG = {
  preSharedKey: 'vpnsecret',
} as const;

/** Cloud WAN 側 Site-to-Site VPN 設定 (VPN VPC 1) */
export const CLOUD_WAN_VPN_CONFIG = {
  cgwBgpAsn: 64901,
  tunnel1InsideCidr: '169.254.10.0/30',
  tunnel2InsideCidr: '169.254.10.4/30',
  awsBgpAsn: CORE_NETWORK_CONFIG.edgeAsn,
} as const;

/** TGW1 側 Site-to-Site VPN 設定 (VPN VPC 2) */
export const TGW1_VPN_CONFIG = {
  cgwBgpAsn: 64902,
  tunnel1InsideCidr: '169.254.20.0/30',
  tunnel2InsideCidr: '169.254.20.4/30',
  awsBgpAsn: TGW1_CONFIG.amazonSideAsn,
} as const;

/** TGW2 側 Site-to-Site VPN 設定 (VPN VPC 3) */
export const TGW2_VPN_CONFIG = {
  cgwBgpAsn: 64903,
  tunnel1InsideCidr: '169.254.30.0/30',
  tunnel2InsideCidr: '169.254.30.4/30',
  awsBgpAsn: TGW2_CONFIG.amazonSideAsn,
} as const;

/** VPC ごとのネットワーク設定 */
export interface VpcNetworkConfig {
  readonly vpcCidr: string;
}

/** ネットワーク設定 */
export const NETWORK_CONFIG = {
  cloudWanPrivate: { vpcCidr: '10.0.0.0/16' },
  cloudWanVpn: { vpcCidr: '10.1.0.0/16' },
  tgwPrivate1: { vpcCidr: '10.10.0.0/16' },
  tgwVpn1: { vpcCidr: '10.11.0.0/16' },
  tgwPrivate2: { vpcCidr: '10.20.0.0/16' },
  tgwVpn2: { vpcCidr: '10.21.0.0/16' },
} as const satisfies Record<string, VpcNetworkConfig>;

/** 擬似オンプレ拠点 (Site/Device/Link) のメタデータ */
export interface OnPremSiteConfig {
  readonly siteDescription: string;
  readonly siteAddress: string;
  readonly siteLatitude: string;
  readonly siteLongitude: string;
  readonly deviceDescription: string;
  readonly deviceVendor: string;
  readonly deviceModel: string;
  readonly deviceType: string;
  readonly linkDescription: string;
  readonly linkType: string;
  readonly linkProvider: string;
  readonly linkUploadSpeed: number;
  readonly linkDownloadSpeed: number;
}

/** Device/Link はベンダー Libreswan で全拠点共通 */
const COMMON_DEVICE_LINK = {
  deviceDescription: 'Libreswan IPsec VPN router (Mock on-prem)',
  deviceVendor: 'Libreswan Project',
  deviceModel: 'Libreswan + FRR on Amazon Linux 2023',
  deviceType: 'ipsec-router',
  linkDescription: 'Broadband uplink (Mock)',
  linkType: 'broadband',
  linkProvider: 'Internet',
  linkUploadSpeed: 1000,
  linkDownloadSpeed: 1000,
} as const satisfies Omit<
  OnPremSiteConfig,
  'siteDescription' | 'siteAddress' | 'siteLatitude' | 'siteLongitude'
>;

/** 擬似オンプレ拠点 (https://classmethod.jp/company/access/ を参考) */
export const ON_PREM_SITE_CONFIG = {
  vpn1: {
    siteDescription: 'Mock on-prem site - Classmethod Hibiya HQ',
    siteAddress: '東京都港区西新橋1-1-1 日比谷フォートタワー26階',
    siteLatitude: '35.6713',
    siteLongitude: '139.7541',
    ...COMMON_DEVICE_LINK,
  },
  vpn2: {
    siteDescription: 'Mock on-prem site - Classmethod Sapporo office',
    siteAddress: '北海道札幌市中央区北3条西1-1-1 札幌ブリックキューブ10階',
    siteLatitude: '43.0651',
    siteLongitude: '141.3534',
    ...COMMON_DEVICE_LINK,
  },
  vpn3: {
    siteDescription: 'Mock on-prem site - Classmethod Osaka office',
    siteAddress: '大阪府大阪市中央区伏見町3-6-3 三菱UFJ信託銀行大阪ビル8階',
    siteLatitude: '34.6892',
    siteLongitude: '135.5023',
    ...COMMON_DEVICE_LINK,
  },
} as const satisfies Record<string, OnPremSiteConfig>;
