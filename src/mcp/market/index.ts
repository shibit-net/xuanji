/**
 * ============================================================
 * MCP Market Module — Tiangong Marketplace
 * ============================================================
 * Starship 天工坊市场集成，提供 MCP 包的搜索、安装、卸载。
 *
 * 使用精确导出避免 TiangongMarket 的 SearchOptions/SearchResult
 * 与 MCPInstaller 的 InstallerSearchOptions/InstallerSearchResult 冲突。
 */

export {
  TiangongMarket,
  TiangongMarketError,
} from './TiangongMarket';
export type {
  MarketConfig,
  MarketPackage,
  MarketPackageDetail,
  MarketVersion,
  InstallConfig,
  DownloadInfo,
  UpdateCheckItem,
} from './TiangongMarket';

export {
  MCPInstaller,
} from './MCPInstaller';
export type {
  InstallOptions,
  InstallResult,
  InstallerSearchOptions,
  InstallerSearchResult,
} from './MCPInstaller';

export {
  UpdateChecker,
} from './UpdateChecker';
export type {
  UpdateCheckResult,
  InstalledPackage,
} from './UpdateChecker';
