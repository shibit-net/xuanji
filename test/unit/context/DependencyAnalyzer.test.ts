import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DependencyAnalyzer } from '@/context/DependencyAnalyzer';

describe('DependencyAnalyzer', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `xuanji-dep-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // ============================================================
  // Node.js
  // ============================================================

  describe('Node.js projects', () => {
    it('should parse package.json dependencies', async () => {
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          description: 'A test project',
          dependencies: {
            react: '^18.0.0',
            lodash: '4.17.21',
          },
          devDependencies: {
            vitest: '^1.0.0',
          },
        }),
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('node');

      expect(info.totalCount).toBe(3);
      expect(info.dependencies.size).toBe(2);
      expect(info.devDependencies.size).toBe(1);
      expect(info.dependencies.get('react')).toBe('^18.0.0');
      expect(info.dependencies.get('lodash')).toBe('4.17.21');
      expect(info.devDependencies.get('vitest')).toBe('^1.0.0');
      expect(info.metadata.projectName).toBe('test-project');
      expect(info.metadata.version).toBe('1.0.0');
      expect(info.metadata.description).toBe('A test project');
    });

    it('should handle missing package.json', async () => {
      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('node');

      expect(info.totalCount).toBe(0);
      expect(info.dependencies.size).toBe(0);
      expect(info.devDependencies.size).toBe(0);
    });

    it('should handle malformed package.json', async () => {
      await writeFile(join(testDir, 'package.json'), 'invalid json {');

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('node');

      expect(info.totalCount).toBe(0);
    });

    it('should handle package.json with no dependencies', async () => {
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({ name: 'empty-project' }),
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('node');

      expect(info.totalCount).toBe(0);
      expect(info.metadata.projectName).toBe('empty-project');
    });
  });

  // ============================================================
  // Python
  // ============================================================

  describe('Python projects', () => {
    it('should parse requirements.txt', async () => {
      await writeFile(
        join(testDir, 'requirements.txt'),
        'django==4.2.0\nrequests>=2.28.0\npandas~=2.0.0\n# comment\nflask\n',
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('python');

      expect(info.totalCount).toBe(4);
      expect(info.dependencies.get('django')).toBe('4.2.0');
      expect(info.dependencies.get('requests')).toBe('2.28.0');
      expect(info.dependencies.get('pandas')).toBe('2.0.0');
      expect(info.dependencies.get('flask')).toBe('any');
    });

    it('should skip comments and blank lines in requirements.txt', async () => {
      await writeFile(
        join(testDir, 'requirements.txt'),
        '# this is a comment\n\ndjango==4.2.0\n\n# another comment\n',
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('python');

      expect(info.totalCount).toBe(1);
      expect(info.dependencies.get('django')).toBe('4.2.0');
    });

    it('should prefer pyproject.toml over requirements.txt', async () => {
      await writeFile(
        join(testDir, 'pyproject.toml'),
        `
[project]
dependencies = [
  "django >= 4.0",
  "requests"
]
`,
      );
      await writeFile(join(testDir, 'requirements.txt'), 'flask==2.0.0');

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('python');

      expect(info.dependencies.has('django')).toBe(true);
      expect(info.dependencies.has('flask')).toBe(false);
    });

    it('should handle missing Python dependency files', async () => {
      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('python');

      expect(info.totalCount).toBe(0);
    });
  });

  // ============================================================
  // Java
  // ============================================================

  describe('Java projects', () => {
    it('should parse pom.xml', async () => {
      await writeFile(
        join(testDir, 'pom.xml'),
        `<project>
          <dependencies>
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
              <version>3.0.0</version>
            </dependency>
            <dependency>
              <groupId>junit</groupId>
              <artifactId>junit</artifactId>
            </dependency>
          </dependencies>
        </project>`,
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('java');

      expect(info.totalCount).toBe(2);
      expect(
        info.dependencies.get(
          'org.springframework.boot:spring-boot-starter-web',
        ),
      ).toBe('3.0.0');
      expect(info.dependencies.get('junit:junit')).toBe('managed');
    });

    it('should parse build.gradle', async () => {
      await writeFile(
        join(testDir, 'build.gradle'),
        `
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web:3.0.0'
    api 'com.google.guava:guava:31.1'
}
`,
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('java');

      expect(info.totalCount).toBe(2);
      expect(
        info.dependencies.get(
          'org.springframework.boot:spring-boot-starter-web',
        ),
      ).toBe('3.0.0');
      expect(info.dependencies.get('com.google.guava:guava')).toBe('31.1');
    });

    it('should prefer pom.xml over build.gradle', async () => {
      await writeFile(
        join(testDir, 'pom.xml'),
        `<project>
          <dependencies>
            <dependency>
              <groupId>junit</groupId>
              <artifactId>junit</artifactId>
              <version>4.13.2</version>
            </dependency>
          </dependencies>
        </project>`,
      );
      await writeFile(
        join(testDir, 'build.gradle'),
        `dependencies { implementation 'com.google.guava:guava:31.1' }`,
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('java');

      // Should parse pom.xml, not build.gradle
      expect(info.dependencies.has('junit:junit')).toBe(true);
      expect(info.dependencies.has('com.google.guava:guava')).toBe(false);
    });

    it('should handle missing Java build files', async () => {
      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('java');

      expect(info.totalCount).toBe(0);
    });
  });

  // ============================================================
  // Go
  // ============================================================

  describe('Go projects', () => {
    it('should parse go.mod require block', async () => {
      await writeFile(
        join(testDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
\tgithub.com/gin-gonic/gin v1.9.0
\tgithub.com/stretchr/testify v1.8.0
)
`,
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('go');

      expect(info.totalCount).toBe(2);
      expect(info.dependencies.get('github.com/gin-gonic/gin')).toBe('v1.9.0');
      expect(info.dependencies.get('github.com/stretchr/testify')).toBe(
        'v1.8.0',
      );
    });

    it('should parse single-line require', async () => {
      await writeFile(
        join(testDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require github.com/gin-gonic/gin v1.9.0
`,
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('go');

      expect(info.totalCount).toBe(1);
      expect(info.dependencies.get('github.com/gin-gonic/gin')).toBe('v1.9.0');
    });

    it('should handle missing go.mod', async () => {
      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('go');

      expect(info.totalCount).toBe(0);
    });
  });

  // ============================================================
  // Rust
  // ============================================================

  describe('Rust projects', () => {
    it('should parse Cargo.toml', async () => {
      await writeFile(
        join(testDir, 'Cargo.toml'),
        `[package]
name = "myapp"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }

[dev-dependencies]
criterion = "0.5"
`,
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('rust');

      expect(info.totalCount).toBe(3);
      expect(info.dependencies.get('serde')).toBe('1.0');
      expect(info.dependencies.get('tokio')).toBe('1.0');
      expect(info.devDependencies.get('criterion')).toBe('0.5');
    });

    it('should handle missing Cargo.toml', async () => {
      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('rust');

      expect(info.totalCount).toBe(0);
    });
  });

  // ============================================================
  // Unknown project type
  // ============================================================

  describe('Unknown project type', () => {
    it('should return empty info for unknown project type', async () => {
      const analyzer = new DependencyAnalyzer(testDir);
      const info = await analyzer.analyze('unknown');

      expect(info.totalCount).toBe(0);
      expect(info.dependencies.size).toBe(0);
      expect(info.devDependencies.size).toBe(0);
    });
  });

  // ============================================================
  // Caching
  // ============================================================

  describe('Caching', () => {
    it('should cache analysis results', async () => {
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { react: '18.0.0' } }),
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info1 = await analyzer.analyze('node');
      const info2 = await analyzer.analyze('node');

      expect(info1).toBe(info2); // 同一引用
    });

    it('should clear cache', async () => {
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { react: '18.0.0' } }),
      );

      const analyzer = new DependencyAnalyzer(testDir);
      const info1 = await analyzer.analyze('node');
      analyzer.clearCache();
      const info2 = await analyzer.analyze('node');

      expect(info1).not.toBe(info2); // 不同引用
      expect(info1.totalCount).toBe(info2.totalCount); // 但内容相同
    });

    it('should return cached dependencies via getCachedDependencies', async () => {
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { react: '18.0.0' } }),
      );

      const analyzer = new DependencyAnalyzer(testDir);

      // 未分析前应返回 null
      expect(analyzer.getCachedDependencies()).toBeNull();

      const info = await analyzer.analyze('node');
      expect(analyzer.getCachedDependencies()).toBe(info);

      analyzer.clearCache();
      expect(analyzer.getCachedDependencies()).toBeNull();
    });
  });
});
