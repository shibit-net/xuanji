// ============================================================
// 天工坊类型定义
// ============================================================

/** 包类型 */
export type PackageType = 1 | 2; // 1=MCP Server, 2=Agent Skill

/** 包状态 */
export type PackageStatus = 1 | 2 | 3 | 4; // 待审核/已发布/已下架/已禁用

/** 包列表项 */
export interface PackageListItem {
  id: number;
  packageId: string;
  name: string;
  type: PackageType;
  description: string;
  authorName?: string;
  categoryName?: string;
  totalDownloads: number;
  ratingAvg: number;
  ratingCount: number;
  qualityScore: number;
  securityScore: number;
  isPrivate?: boolean;
  requiresSubscription?: boolean;
  status: PackageStatus;
  certificationStatus: number;
  pricingType: number;
  price: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 包详情 */
export interface PackageDetail extends PackageListItem {
  homepageUrl?: string;
  repositoryUrl?: string;
  license?: string;
  source: number;
  metadata?: string;
  versions: VersionInfo[];
  reviews: ReviewInfo[];
}

/** 版本信息 */
export interface VersionInfo {
  id: number;
  version: string;
  changelog?: string;
  downloadUrl?: string;
  downloads: number;
  status: number;
  compatibility?: string;
  createdAt: string;
}

/** 评论信息 */
export interface ReviewInfo {
  id: number;
  userId: number;
  rating: number;
  content?: string;
  helpfulCount: number;
  createdAt: string;
}

/** 安装配置 */
export interface InstallConfig {
  type: 'mcp' | 'skill';
  installScript?: string;
  configTemplate: string; // JSON string
  compatibility?: string; // JSON string
  versionId: number;
  version: string;
}

/** 搜索选项 */
export interface SearchOptions {
  type?: PackageType;
  category?: number;
  sort?: 'downloads' | 'rating' | 'updated_at' | 'created_at';
  page?: number;
  pageSize?: number;
}

/** 搜索结果 */
export interface SearchResult {
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
  list: PackageListItem[];
}

/** 已安装的包记录 */
export interface InstalledPackage {
  packageId: string;
  name: string;
  type: 'mcp' | 'skill';
  version: string;
  installedAt: string;
  installPath: string;
}

/** MCP Server 配置 */
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  transport?: 'stdio' | 'sse';
  env?: Record<string, string>;
}

/** Skill 配置 */
export interface SkillFilesConfig {
  installPath: string;
  files: Record<string, string>;
}

/** 订阅项 */
export interface SubscriptionItem {
  subscriptionId: number;
  packageId: string;
  packageName: string;
  status: number;  // 1=生效中, 2=已暂停, 3=已取消
  configs: Record<string, string>;  // 脱敏值
  expiresAt?: string;
}

/** 订阅配置（安装时使用） */
export interface SubscriptionConfig {
  packageId: string;
  configTemplate: string;  // JSON string，包含 env
}
