/**
 * ============================================================
 * M3 上下文引擎 — DependencyAnalyzer
 * ============================================================
 * 解析项目依赖配置文件，提取依赖关系信息。
 *
 * 支持的项目类型：
 * - Node.js: package.json
 * - Java: pom.xml / build.gradle / build.gradle.kts
 * - Python: pyproject.toml / requirements.txt
 * - Go: go.mod
 * - Rust: Cargo.toml
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';
import type { ProjectType, DependencyInfo } from './types';

const log = logger.child({ module: 'DependencyAnalyzer' });

/** 最大文件大小（5MB） */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export class DependencyAnalyzer {
  private rootPath: string;
  private cachedDependencies: DependencyInfo | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * 分析项目依赖
   */
  async analyze(projectType: ProjectType): Promise<DependencyInfo> {
    if (this.cachedDependencies) {
      return this.cachedDependencies;
    }

    try {
      let info: DependencyInfo;

      switch (projectType) {
        case 'node':
          info = await this.analyzeNode();
          break;
        case 'java':
          info = await this.analyzeJava();
          break;
        case 'python':
          info = await this.analyzePython();
          break;
        case 'go':
          info = await this.analyzeGo();
          break;
        case 'rust':
          info = await this.analyzeRust();
          break;
        default:
          info = this.emptyDependencyInfo();
      }

      this.cachedDependencies = info;
      log.info(`Analyzed ${info.totalCount} dependencies for ${projectType} project`);
      return info;
    } catch (error) {
      log.error('Failed to analyze dependencies:', error);
      return this.emptyDependencyInfo();
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedDependencies = null;
  }

  /**
   * 获取缓存的依赖信息
   */
  getCachedDependencies(): DependencyInfo | null {
    return this.cachedDependencies;
  }

  // ============================================================
  // Node.js
  // ============================================================

  private async analyzeNode(): Promise<DependencyInfo> {
    const filePath = join(this.rootPath, 'package.json');

    if (!existsSync(filePath)) {
      log.debug('package.json not found');
      return this.emptyDependencyInfo();
    }

    try {
      const content = await this.safeReadFile(filePath, 'package.json');
      const pkg = JSON.parse(content);

      const dependencies = new Map<string, string>(
        Object.entries(pkg.dependencies || {}),
      );
      const devDependencies = new Map<string, string>(
        Object.entries(pkg.devDependencies || {}),
      );

      return {
        dependencies,
        devDependencies,
        totalCount: dependencies.size + devDependencies.size,
        metadata: {
          projectName: pkg.name,
          version: pkg.version,
          description: pkg.description,
        },
      };
    } catch (error) {
      log.warn('Failed to parse package.json:', error);
      return this.emptyDependencyInfo();
    }
  }

  // ============================================================
  // Java
  // ============================================================

  private async analyzeJava(): Promise<DependencyInfo> {
    // 优先 pom.xml（Maven）
    const pomPath = join(this.rootPath, 'pom.xml');
    if (existsSync(pomPath)) {
      return this.analyzeMaven(pomPath);
    }

    // 其次 build.gradle（Gradle）
    const gradlePath = join(this.rootPath, 'build.gradle');
    if (existsSync(gradlePath)) {
      return this.analyzeGradle(gradlePath);
    }

    // 最后 build.gradle.kts（Kotlin DSL）
    const gradleKtsPath = join(this.rootPath, 'build.gradle.kts');
    if (existsSync(gradleKtsPath)) {
      return this.analyzeGradle(gradleKtsPath);
    }

    log.debug('No Java build file found');
    return this.emptyDependencyInfo();
  }

  private async analyzeMaven(filePath: string): Promise<DependencyInfo> {
    try {
      const content = await this.safeReadFile(filePath, 'pom.xml');
      const dependencies = new Map<string, string>();

      // 提取每个 <dependency> 块
      const depBlockPattern = /<dependency>([\s\S]*?)<\/dependency>/g;

      let blockMatch;
      while ((blockMatch = depBlockPattern.exec(content)) !== null) {
        const block = blockMatch[1];
        const groupId = block.match(/<groupId>(.*?)<\/groupId>/)?.[1];
        const artifactId = block.match(/<artifactId>(.*?)<\/artifactId>/)?.[1];
        const version = block.match(/<version>(.*?)<\/version>/)?.[1];

        if (groupId && artifactId) {
          dependencies.set(`${groupId}:${artifactId}`, version || 'managed');
        }
      }

      return {
        dependencies,
        devDependencies: new Map(),
        totalCount: dependencies.size,
        metadata: {},
      };
    } catch (error) {
      log.warn('Failed to parse pom.xml:', error);
      return this.emptyDependencyInfo();
    }
  }

  private async analyzeGradle(filePath: string): Promise<DependencyInfo> {
    try {
      const content = await this.safeReadFile(filePath, 'build.gradle');
      const dependencies = new Map<string, string>();

      const depPattern =
        /(?:implementation|api|compile|runtimeOnly)\s+['"]([^'"]+)['"]/g;

      let match;
      while ((match = depPattern.exec(content)) !== null) {
        const dep = match[1];
        const parts = dep.split(':');
        if (parts.length >= 2) {
          const key = `${parts[0]}:${parts[1]}`;
          const version = parts[2] || 'latest';
          dependencies.set(key, version);
        }
      }

      return {
        dependencies,
        devDependencies: new Map(),
        totalCount: dependencies.size,
        metadata: {},
      };
    } catch (error) {
      log.warn('Failed to parse build.gradle:', error);
      return this.emptyDependencyInfo();
    }
  }

  // ============================================================
  // Python
  // ============================================================

  private async analyzePython(): Promise<DependencyInfo> {
    // 优先 pyproject.toml（现代标准）
    const pyprojectPath = join(this.rootPath, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      return this.analyzePyproject(pyprojectPath);
    }

    // 其次 requirements.txt（传统方式）
    const reqPath = join(this.rootPath, 'requirements.txt');
    if (existsSync(reqPath)) {
      return this.analyzeRequirements(reqPath);
    }

    log.debug('No Python dependency file found');
    return this.emptyDependencyInfo();
  }

  private async analyzeRequirements(filePath: string): Promise<DependencyInfo> {
    try {
      const content = await this.safeReadFile(filePath, 'requirements.txt');
      const dependencies = new Map<string, string>();

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(
          /^([a-zA-Z0-9_-]+)\s*([><=~!]+)?\s*([0-9.]+)?/,
        );
        if (match) {
          const [, pkg, , version] = match;
          dependencies.set(pkg, version || 'any');
        }
      }

      return {
        dependencies,
        devDependencies: new Map(),
        totalCount: dependencies.size,
        metadata: {},
      };
    } catch (error) {
      log.warn('Failed to parse requirements.txt:', error);
      return this.emptyDependencyInfo();
    }
  }

  private async analyzePyproject(filePath: string): Promise<DependencyInfo> {
    try {
      const content = await this.safeReadFile(filePath, 'pyproject.toml');
      const dependencies = new Map<string, string>();

      const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsMatch) {
        const depsStr = depsMatch[1];
        const depPattern =
          /"([a-zA-Z0-9_-]+)\s*([><=~!]+)?\s*([0-9.]+)?"/g;

        let match;
        while ((match = depPattern.exec(depsStr)) !== null) {
          const [, pkg, , version] = match;
          dependencies.set(pkg, version || 'any');
        }
      }

      return {
        dependencies,
        devDependencies: new Map(),
        totalCount: dependencies.size,
        metadata: {},
      };
    } catch (error) {
      log.warn('Failed to parse pyproject.toml:', error);
      return this.emptyDependencyInfo();
    }
  }

  // ============================================================
  // Go
  // ============================================================

  private async analyzeGo(): Promise<DependencyInfo> {
    const filePath = join(this.rootPath, 'go.mod');

    if (!existsSync(filePath)) {
      log.debug('go.mod not found');
      return this.emptyDependencyInfo();
    }

    try {
      const content = await this.safeReadFile(filePath, 'go.mod');
      const dependencies = new Map<string, string>();

      // require 块
      const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
      if (requireMatch) {
        for (const line of requireMatch[1].split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            dependencies.set(parts[0], parts[1]);
          }
        }
      }

      // 单行 require
      const singlePattern = /require\s+([^\s(]+)\s+([^\s]+)/g;
      let match;
      while ((match = singlePattern.exec(content)) !== null) {
        dependencies.set(match[1], match[2]);
      }

      return {
        dependencies,
        devDependencies: new Map(),
        totalCount: dependencies.size,
        metadata: {},
      };
    } catch (error) {
      log.warn('Failed to parse go.mod:', error);
      return this.emptyDependencyInfo();
    }
  }

  // ============================================================
  // Rust
  // ============================================================

  private async analyzeRust(): Promise<DependencyInfo> {
    const filePath = join(this.rootPath, 'Cargo.toml');

    if (!existsSync(filePath)) {
      log.debug('Cargo.toml not found');
      return this.emptyDependencyInfo();
    }

    try {
      const content = await this.safeReadFile(filePath, 'Cargo.toml');
      const dependencies = new Map<string, string>();
      const devDependencies = new Map<string, string>();

      const depsMatch = content.match(
        /\[dependencies\]([\s\S]*?)(?=\[|$)/,
      );
      if (depsMatch) {
        this.parseTomlDependencies(depsMatch[1], dependencies);
      }

      const devDepsMatch = content.match(
        /\[dev-dependencies\]([\s\S]*?)(?=\[|$)/,
      );
      if (devDepsMatch) {
        this.parseTomlDependencies(devDepsMatch[1], devDependencies);
      }

      return {
        dependencies,
        devDependencies,
        totalCount: dependencies.size + devDependencies.size,
        metadata: {},
      };
    } catch (error) {
      log.warn('Failed to parse Cargo.toml:', error);
      return this.emptyDependencyInfo();
    }
  }

  private parseTomlDependencies(
    block: string,
    target: Map<string, string>,
  ): void {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 简单格式：crate = "version"
      const simpleMatch = trimmed.match(
        /^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/,
      );
      if (simpleMatch) {
        target.set(simpleMatch[1], simpleMatch[2]);
        continue;
      }

      // 复杂格式：crate = { version = "x.y.z", ... }
      const complexMatch = trimmed.match(
        /^([a-zA-Z0-9_-]+)\s*=\s*\{.*version\s*=\s*"([^"]+)"/,
      );
      if (complexMatch) {
        target.set(complexMatch[1], complexMatch[2]);
      }
    }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private async safeReadFile(
    filePath: string,
    label: string,
  ): Promise<string> {
    const fileStat = await stat(filePath);

    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`${label} exceeds 5MB (${fileStat.size} bytes)`);
    }

    return readFile(filePath, 'utf-8');
  }

  private emptyDependencyInfo(): DependencyInfo {
    return {
      dependencies: new Map(),
      devDependencies: new Map(),
      totalCount: 0,
      metadata: {},
    };
  }
}
