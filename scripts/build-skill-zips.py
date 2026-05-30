#!/usr/bin/env python3
"""
Phase 1 + 2: 为天工坊 Skill 构建可安装的 ZIP 包

策略：
  - bundle (GitHub ZIP 可下载): 下载 GitHub ZIP → 提取 CLAUDE.md/SKILL.md/AGENTS.md → 生成 SKILL.md
  - stdio / bundle (GitHub 不可下载): 从元数据生成 SKILL.md

输出: ./output/skills/{packageId}/ 目录下生成 SKILL.md + skill.zip
"""

import json
import os
import sys
import zipfile
import io
import urllib.request
import urllib.error
import tempfile
import shutil
import time
import hashlib
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
JSON_PATH = PROJECT_DIR / "docs" / "tiangong-mcp-skills-top200.json"
OUTPUT_DIR = PROJECT_DIR / "output" / "skills"
BACKEND_API = "https://test.shibit.net/api"

# ============================================================
# YAML frontmatter 生成（不依赖 pyyaml）
# ============================================================

def yaml_str(val):
    """安全地输出 YAML 字符串值"""
    if isinstance(val, str):
        # 转义反斜杠和引号
        escaped = val.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return str(val)

def yaml_list(vals):
    """输出 YAML 列表"""
    return "[" + ", ".join(yaml_str(v) for v in vals) + "]"

def generate_frontmatter(skill: dict) -> str:
    """生成 SKILL.md 的 YAML frontmatter"""
    lines = ["---"]
    lines.append(f"id: {yaml_str(skill['packageId'])}")
    lines.append(f"name: {skill['name']}")

    version = skill.get("version", "1.0.0")
    lines.append(f"version: {yaml_str(version)}")

    desc = skill.get("description", "").replace("\n", " ")
    lines.append(f"description: {yaml_str(desc)}")

    lines.append("category: prompt")

    tags = skill.get("tags", [])
    if tags:
        lines.append(f"tags: {yaml_list(tags)}")

    author = skill.get("authorName")
    if author:
        lines.append(f"author: {yaml_str(author)}")

    repo_url = skill.get("repositoryUrl")
    if repo_url:
        lines.append(f"repositoryUrl: {yaml_str(repo_url)}")

    params = []
    transport = skill.get("transport", "")
    config = skill.get("configTemplate", "")
    if transport:
        params.append(f"    transport: {yaml_str(transport)}")
    if config:
        config_str = config if isinstance(config, str) else json.dumps(config)
        params.append(f"    configTemplate: {yaml_str(config_str)}")
    if params:
        lines.append("parameters:")
        lines.extend(params)

    lines.append("---")
    return "\n".join(lines) + "\n"


def generate_body_default(skill: dict) -> str:
    """从元数据生成 SKILL.md 正文"""
    parts = []
    parts.append(f"# {skill['name']}")
    parts.append("")

    desc = skill.get("description", "")
    if desc:
        parts.append("## 概述")
        parts.append("")
        parts.append(desc)
        parts.append("")

    tags = skill.get("tags", [])
    if tags:
        parts.append("## 标签")
        parts.append("")
        parts.append(", ".join(tags))
        parts.append("")

    repo_url = skill.get("repositoryUrl")
    if repo_url:
        parts.append(f"**仓库**: {repo_url}")
        parts.append("")

    transport = skill.get("transport", "")
    if transport == "stdio":
        config_str = skill.get("configTemplate", "")
        if config_str:
            try:
                config = json.loads(config_str) if isinstance(config_str, str) else config_str
                cmd = config.get("command", "")
                args = config.get("args", [])
                if cmd:
                    parts.append("## 运行方式")
                    parts.append("")
                    parts.append(f"```bash\n{cmd} {' '.join(args)}\n```")
                    parts.append("")
            except (json.JSONDecodeError, TypeError):
                pass

    parts.append("## 使用方法")
    parts.append("")
    parts.append(f"调用 `skill_call(skillId=\"{skill['packageId']}\")` 获取此 Skill 的完整指导内容。")
    parts.append("")

    return "\n".join(parts)


# ============================================================
# npm 包内容提取 (stdio 类型)
# ============================================================

def extract_npm_content(config_template: str) -> tuple[str | None, str]:
    """尝试从 npm 包获取内容。返回 (body, source_description)。"""
    try:
        config = json.loads(config_template) if isinstance(config_template, str) else config_template
    except (json.JSONDecodeError, TypeError):
        return None, "invalid configTemplate"

    pkg_name = None
    args = config.get("args", [])
    for a in args:
        if not a.startswith("-"):
            pkg_name = a
            break
    if not pkg_name:
        return None, "no package name in args"

    import subprocess
    try:
        # 先获取 readme
        result = subprocess.run(
            ["npm", "view", pkg_name, "readme"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return None, f"npm package {pkg_name} not found"

        readme = result.stdout.strip()
        if readme and len(readme) > 200:
            return readme, f"npm README ({len(readme)} chars)"

        # 回退到 description
        result = subprocess.run(
            ["npm", "view", pkg_name, "description"],
            capture_output=True, text=True, timeout=15
        )
        desc = result.stdout.strip()
        if desc:
            content = f"# {pkg_name}\n\n{desc}\n\n**Install**: `npx -y {pkg_name}`\n"
            return content, f"npm description ({len(desc)} chars)"

        return None, "npm package has no README or description"
    except Exception as e:
        return None, f"npm extraction failed: {e}"


# ============================================================
# GitHub ZIP 下载 & 内容提取
# ============================================================

CONTENT_FILES = ["SKILL.md", "CLAUDE.md", "AGENTS.md", "README.md", "INSTALL.md"]

def download_github_zip(download_url: str, try_alternatives: bool = True) -> tuple[bytes | None, str]:
    """下载 GitHub archive ZIP。返回 (content, effective_url)。支持多 URL 回退。"""
    urls_to_try = [download_url]
    if try_alternatives:
        urls_to_try.append(download_url.replace('/main.zip', '/master.zip'))
        urls_to_try.append(download_url.replace('/archive/refs/heads/', '/archive/'))

    last_error = None
    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "xuanji-skill-builder/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read(), url
        except Exception as e:
            last_error = e

    raise last_error or Exception("All URLs failed")


def extract_best_content(zip_bytes: bytes) -> str | None:
    """从 GitHub ZIP 中提取最合适的 Skill 内容文件"""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        all_files = zf.namelist()

        # 找到仓库根目录（去掉外层目录前缀）
        root_dirs = set()
        for f in all_files:
            if "/" in f:
                root_dirs.add(f.split("/")[0])
        root = sorted(root_dirs, key=len)[0] if root_dirs else ""

        # 按优先级查找内容文件
        for content_file in CONTENT_FILES:
            candidates = []
            if root:
                candidates.append(f"{root}/{content_file}")
            # 也查找任意子目录
            for f in all_files:
                if f.endswith(f"/{content_file}"):
                    candidates.append(f)
            for cand in candidates:
                if cand in all_files:
                    return zf.read(cand).decode("utf-8", errors="replace")
    return None


def build_body_from_github_content(content: str, skill_name: str) -> str:
    """将 GitHub 原始内容包装为 SKILL.md body"""
    # 如果内容开头已经是 # 标题，直接保留
    content = content.strip()
    if not content.startswith("#"):
        content = f"# {skill_name}\n\n{content}"
    return content


# ============================================================
# ZIP 打包
# ============================================================

def create_skill_zip(frontmatter: str, body: str, package_id: str) -> str:
    """创建 xuanji 兼容的 Skill ZIP 包"""
    skill_md = frontmatter + "\n" + body

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("SKILL.md", skill_md)

    skill_dir = OUTPUT_DIR / package_id
    skill_dir.mkdir(parents=True, exist_ok=True)

    # 写入 SKILL.md
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")

    # 写入 ZIP
    zip_path = skill_dir / "skill.zip"
    zip_path.write_bytes(buf.getvalue())

    # 写入 manifest
    manifest = {
        "skillId": package_id,
        "packageId": package_id,
        "version": "1.0.0",
        "format": "xuanji-skill-zip-v1",
    }
    (skill_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    return str(skill_dir)


# ============================================================
# 上传到后端
# ============================================================

def upload_to_backend(package_id: str, skill_dir: str, version_id: int) -> bool:
    """上传 ZIP 到天工坊后端文件存储"""
    zip_path = Path(skill_dir) / "skill.zip"
    if not zip_path.exists():
        print(f"  ZIP not found: {zip_path}")
        return False

    import subprocess
    curl_cmd = [
        "curl", "-s",
        "-X", "POST",
        f"{BACKEND_API}/tiangong/user/packages/{package_id}/versions/{version_id}/upload",
        "-F", f"file=@{zip_path}",
        "--connect-timeout", "30",
    ]
    try:
        result = subprocess.run(curl_cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            try:
                resp = json.loads(result.stdout)
                if resp.get("success") or resp.get("code") == 200:
                    return True
                print(f"  Upload API error: {resp.get('message', 'unknown')}")
            except json.JSONDecodeError:
                print(f"  Upload response: {result.stdout[:200]}")
        else:
            print(f"  Upload failed: {result.stderr[:200]}")
        return False
    except Exception as e:
        print(f"  Upload exception: {e}")
        return False


# ============================================================
# 主流程
# ============================================================

def process_skill(skill: dict, upload: bool = False):
    """处理单个 Skill"""
    package_id = skill["packageId"]
    name = skill["name"]
    transport = skill.get("transport", "")
    download_url = skill.get("downloadUrl", "")

    print(f"\n{'='*60}")
    print(f"Processing: {package_id} ({name})")
    print(f"  Transport: {transport}")

    # 生成 frontmatter
    frontmatter = generate_frontmatter(skill)

    # 尝试获取真实内容
    body = None
    content_source = "generated"

    if transport == "bundle" and download_url:
        print(f"  Downloading: {download_url[:80]}...")
        try:
            zip_bytes, effective_url = download_github_zip(download_url)
            if effective_url != download_url:
                print(f"  Used alternative URL: {effective_url[:80]}")
            content = extract_best_content(zip_bytes)
            if content:
                body = build_body_from_github_content(content, name)
                content_source = f"github ({len(body)} chars)"
                print(f"  Extracted real content: {len(body)} chars")
            else:
                print(f"  No content file found in GitHub ZIP")
        except Exception as e:
            print(f"  GitHub download failed: {e}")

    # npm stdio 类型：尝试从 npm 包提取内容
    if not body and transport == "stdio":
        config = skill.get("configTemplate", "")
        if config:
            print(f"  Trying npm extraction...")
            npm_body, npm_source = extract_npm_content(config)
            if npm_body:
                body = npm_body
                content_source = npm_source
                print(f"  Extracted npm content: {len(body)} chars")
            else:
                print(f"  npm extraction failed: {npm_source}")

    # 回退到生成内容
    if not body:
        body = generate_body_default(skill)
        print(f"  Generated from metadata: {len(body)} chars")

    # 创建 ZIP
    skill_dir = create_skill_zip(frontmatter, body, package_id)
    print(f"  Created: {skill_dir}/skill.zip")

    # 上传（可选）
    if upload:
        version_id = skill.get("versionId")
        if version_id:
            success = upload_to_backend(package_id, skill_dir, version_id)
            print(f"  Upload: {'SUCCESS' if success else 'FAILED'}")
        else:
            print(f"  Skip upload: no versionId in source data")

    return {"package_id": package_id, "content_source": content_source, "dir": skill_dir}


def main():
    with open(JSON_PATH) as f:
        data = json.load(f)

    skills = [p for p in data["packages"] if p["type"] == 2]
    print(f"Total skills: {len(skills)}")

    upload = "--upload" in sys.argv

    # 确保输出目录存在
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    for i, skill in enumerate(skills):
        try:
            result = process_skill(skill, upload=upload)
            results.append(result)
        except Exception as e:
            print(f"  ERROR processing {skill['packageId']}: {e}")
            results.append({"package_id": skill["packageId"], "error": str(e)})

        # 速率控制
        if i % 5 == 4:
            time.sleep(1)

    # 汇总
    print(f"\n{'='*60}")
    print(f"SUMMARY: {len(results)} skills processed")
    sources = {}
    for r in results:
        src = r.get("content_source", "error")
        sources[src] = sources.get(src, 0) + 1
    for src, cnt in sorted(sources.items()):
        print(f"  {src}: {cnt}")

    # 输出 manifest 列表
    manifest_list = []
    for skill in skills:
        manifest_list.append({
            "skillId": skill["packageId"],
            "name": skill["name"],
            "version": skill.get("version", "1.0.0"),
            "zipDir": str(OUTPUT_DIR / skill["packageId"]),
        })

    manifest_path = OUTPUT_DIR / "manifest-list.json"
    manifest_path.write_text(json.dumps(manifest_list, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nManifest list: {manifest_path}")


if __name__ == "__main__":
    main()
