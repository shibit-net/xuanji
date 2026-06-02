#!/usr/bin/env python3
"""
Generate marketplace entries for Superpowers sub-skills.
Reads SKILL.md frontmatter from .claude/skills/ and produces
JSON entries + SQL INSERT statements.
"""

import json
import os
import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent.parent / '.claude' / 'skills'
JSON_PATH = Path(__file__).parent.parent / 'docs' / 'tiangong-mcp-skills-top200.json'

# Category assignment for each skill
CATEGORY_MAP = {
    'brainstorming': ('开发工作流', ['creative', 'design', 'planning', 'brainstorming']),
    'chinese-code-review': ('开发工作流', ['code-review', 'chinese', 'collaboration']),
    'chinese-commit-conventions': ('开发工作流', ['git', 'commit', 'chinese', 'conventions']),
    'chinese-documentation': ('开发工作流', ['documentation', 'chinese', 'formatting']),
    'chinese-git-workflow': ('开发工作流', ['git', 'chinese', 'gitee', 'coding']),
    'dispatching-parallel-agents': ('开发工作流', ['parallel', 'agents', 'orchestration']),
    'executing-plans': ('开发工作流', ['execution', 'plans', 'workflow']),
    'figma-to-code': ('设计与创意', ['figma', 'design', 'ui', 'pixel-perfect']),
    'finishing-a-development-branch': ('开发工作流', ['git', 'branch', 'merge', 'pr']),
    'mcp-builder': ('框架与SDK', ['mcp', 'builder', 'server', 'tool']),
    'receiving-code-review': ('开发工作流', ['code-review', 'feedback', 'collaboration']),
    'requesting-code-review': ('开发工作流', ['code-review', 'verification', 'quality']),
    'subagent-driven-development': ('开发工作流', ['subagent', 'parallel', 'orchestration']),
    'systematic-debugging': ('开发工作流', ['debugging', 'troubleshooting', 'bug-fix']),
    'test-driven-development': ('开发工作流', ['tdd', 'testing', 'quality']),
    'using-git-worktrees': ('开发工作流', ['git', 'worktree', 'isolation']),
    'using-superpowers': ('框架与SDK', ['superpowers', 'meta', 'skill-index']),
    'verification-before-completion': ('开发工作流', ['verification', 'testing', 'quality']),
    'workflow-runner': ('开发工作流', ['workflow', 'yaml', 'orchestration', 'agency']),
    'writing-plans': ('开发工作流', ['planning', 'design', 'architecture']),
    'writing-skills': ('框架与SDK', ['skills', 'creation', 'meta', 'builder']),
}

# Map skill dir names to frontmatter names
SKILL_DIR_TO_FM = {
    'brainstorming': 'brainstorming',
    'chinese-code-review': 'chinese-code-review',
    'chinese-commit-conventions': 'chinese-commit-conventions',
    'chinese-documentation': 'chinese-documentation',
    'chinese-git-workflow': 'chinese-git-workflow',
    'dispatching-parallel-agents': 'dispatching-parallel-agents',
    'executing-plans': 'executing-plans',
    'figma-to-code': 'figma-to-code',
    'finishing-a-development-branch': 'finishing-a-development-branch',
    'mcp-builder': 'mcp-builder',
    'receiving-code-review': 'receiving-code-review',
    'requesting-code-review': 'requesting-code-review',
    'subagent-driven-development': 'subagent-driven-development',
    'systematic-debugging': 'systematic-debugging',
    'test-driven-development': 'test-driven-development',
    'using-git-worktrees': 'using-git-worktrees',
    'using-superpowers': 'using-superpowers',
    'verification-before-completion': 'verification-before-completion',
    'workflow-runner': 'workflow-runner',
    'writing-plans': 'writing-plans',
    'writing-skills': 'writing-skills',
}


def parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from SKILL.md."""
    trimmed = content.strip()
    if not trimmed.startswith('---'):
        return {}
    end = trimmed.find('---', 3)
    if end == -1:
        return {}
    yaml_block = trimmed[3:end].strip()
    result = {}
    for line in yaml_block.split('\n'):
        line = line.strip()
        if ':' in line:
            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            result[key] = value
    return result


def read_skills() -> list[dict]:
    """Read all SKILL.md files and return skill metadata."""
    skills = []
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / 'SKILL.md'
        if not skill_md.exists():
            continue
        dir_name = skill_dir.name
        content = skill_md.read_text(encoding='utf-8')
        fm = parse_frontmatter(content)
        skills.append({
            'dir': dir_name,
            'name': fm.get('name', dir_name),
            'description': fm.get('description', ''),
        })
    return skills


def build_json_entry(skill: dict, rank: int) -> dict:
    """Build a marketplace JSON entry for a skill."""
    dir_name = skill['dir']
    package_id = f'skill-superpowers-{dir_name}'
    cat, tags = CATEGORY_MAP.get(dir_name, ('开发工作流', ['superpowers']))

    # Truncate description for marketplace display
    desc = skill['description']
    # Remove trailing instruction about when to invoke (already in SKILL.md usage pattern)
    if '仅在用户显式' in desc:
        desc = desc.split('仅在用户显式')[0].strip('。， ')
    if '不要根据上下文自动触发' in desc:
        desc = desc.replace('。仅在用户显式 /chinese-code-review 时调用，不要根据上下文自动触发', '')
        desc = desc.replace('。仅在用户显式 /chinese-documentation 时调用，不要根据上下文自动触发', '')
        desc = desc.replace('。仅在用户显式 /chinese-git-workflow 时调用，不要根据上下文自动触发', '')
        desc = desc.replace('。仅在用户显式 /chinese-commit-conventions 时调用，不要根据上下文自动触发', '')

    return {
        'packageId': package_id,
        'name': skill['name'],
        'type': 2,
        'typeName': 'Agent Skill',
        'categoryName': cat,
        'authorName': 'obra',
        'repositoryUrl': f'https://github.com/obra/superpowers/tree/main/{dir_name}',
        'description': f'[Superpowers 子技能] {desc}',
        'license': 'MIT',
        'source': 3,
        'sourceName': '开源Registry',
        'isOfficial': 1,
        'pricingType': 0,
        'pricingTypeName': '免费',
        'totalDownloads': 0,
        'ratingAvg': 4.8,
        'ratingCount': 0,
        'qualityScore': 9.9,
        'securityScore': 7.7,
        'tags': tags,
        'githubStars': 175000,
        'rank': rank,
        'runtimeType': 'LOCAL_FILE',
        'transportProtocol': 'Local SKILL.md File',
        'installCommand': f'git clone --depth 1 --filter=blob:none --sparse https://github.com/obra/superpowers.git && cd superpowers && git sparse-checkout set {dir_name}',
        'packageRegistry': 'github',
        'packageName': 'obra/superpowers',
        'hasVerifiedPackage': False,
        'needsApiKey': False,
        'isDeprecated': False,
        'downloadUrl': f'https://raw.githubusercontent.com/obra/superpowers/main/{dir_name}/SKILL.md',
        'configTemplate': {
            'name': skill['name'],
            'transport': 'bundle',
            'type': 'skill',
            'subPath': dir_name,
        },
        'transport': 'bundle',
        'runtimeConfig': {},
        'skillType': 'prompt' if dir_name not in ('brainstorming', 'using-superpowers', 'workflow-runner', 'dispatching-parallel-agents', 'subagent-driven-development') else 'action',
    }


def generate_sql_inserts(skills: list[dict], start_id: int) -> list[str]:
    """Generate SQL INSERT statements for tiangong_package and tiangong_version."""
    statements = []
    author_id = 118  # obra

    # Category IDs from the SQL file
    cat_name_to_id = {
        '开发工具': 1,
        '浏览器与测试': 2,
        '搜索与抓取': 3,
        '数据库': 4,
        '云服务与DevOps': 5,
        '文件系统': 6,
        'AI与LLM': 7,
        '安全': 8,
        '金融数据': 9,
        '协作与生产力': 10,
        '设计与创意': 11,
        '科学学术': 12,
        '知识图谱与内存': 13,
        '框架与SDK': 14,
    }

    for i, skill in enumerate(skills):
        pid = start_id + i
        dir_name = skill['dir']
        package_id = f'skill-superpowers-{dir_name}'
        cat, tags = CATEGORY_MAP.get(dir_name, ('开发工作流', ['superpowers']))
        cat_id = cat_name_to_id.get(cat, 1)

        # Build metadata JSON
        metadata = json.dumps({
            'runtimeType': 'LOCAL_FILE',
            'transport': 'bundle',
            'transportProtocol': 'Local SKILL.md File',
            'githubStars': 175000,
            'packageRegistry': 'github',
            'packageName': 'obra/superpowers',
            'installCommand': f'git clone --depth 1 --filter=blob:none --sparse https://github.com/obra/superpowers.git && cd superpowers && git sparse-checkout set {dir_name}',
            'hasVerifiedPackage': False,
            'needsApiKey': False,
            'isDeprecated': False,
            'skillType': 'prompt' if dir_name not in ('brainstorming', 'using-superpowers', 'workflow-runner', 'dispatching-parallel-agents', 'subagent-driven-development') else 'action',
            'parentPackageId': 'skill-superpowers',
            'subPath': dir_name,
        }, ensure_ascii=False)

        # Package INSERT
        desc_clean = skill['description'].replace("'", "''")
        statements.append(
            f"INSERT INTO tiangong_package (id, package_id, name, type, author_id, category_id, "
            f"description, repository_url, license, source, is_private, status, is_official, "
            f"pricing_type, total_downloads, rating_avg, rating_count, quality_score, security_score, "
            f"metadata, created_at, updated_at) VALUES ("
            f"{pid}, '{package_id}', '{skill['name']}', 2, {author_id}, {cat_id}, "
            f"'{desc_clean}', "
            f"'https://github.com/obra/superpowers/tree/main/{dir_name}', "
            f"'MIT', 3, 0, 2, 0, 0, 0, 4.8, 0, 9.9, 7.7, "
            f"'{metadata}', NOW(), NOW());"
        )

        # Version INSERT
        vid = pid  # Use same ID for simplicity
        statements.append(
            f"INSERT INTO tiangong_version (id, package_id, version, changelog, download_url, "
            f"downloads, status, compatibility, created_at) VALUES ("
            f"{vid}, {pid}, '1.0.0', 'Superpowers 子技能 - 从 obra/superpowers 仓库导入', "
            f"'https://raw.githubusercontent.com/obra/superpowers/main/{dir_name}/SKILL.md', "
            f"0, 1, '>=xuanji-0.9.0', NOW());"
        )

    return statements


def main():
    skills = read_skills()
    print(f'Found {len(skills)} skills in .claude/skills/')

    # Load existing JSON
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    existing_ids = {p['packageId'] for p in data['packages']}
    existing_skill_ranks = [p['rank'] for p in data['packages'] if p.get('typeName') == 'Agent Skill']
    max_rank = max(existing_skill_ranks) if existing_skill_ranks else 200
    next_rank = max_rank + 1

    new_entries = []
    skipped = []

    for skill in skills:
        package_id = f'skill-superpowers-{skill["dir"]}'
        if package_id in existing_ids:
            skipped.append(package_id)
            print(f'  SKIP (exists): {package_id}')
            continue
        entry = build_json_entry(skill, next_rank)
        new_entries.append(entry)
        print(f'  ADD: {package_id} (rank={next_rank})')
        next_rank += 1

    print(f'\nNew entries to add: {len(new_entries)}')
    print(f'Skipped (already exist): {len(skipped)}')

    # Append to JSON
    if new_entries:
        data['packages'].extend(new_entries)
        data['metadata']['totalPackages'] = data['metadata'].get('totalPackages', 251) + len(new_entries)

        # Write updated JSON
        with open(JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'\nUpdated {JSON_PATH} with {len(new_entries)} new entries')

    # Generate SQL
    # Find max package ID in existing SQL
    sql_path = Path(__file__).parent.parent / 'docs' / 'tiangong-init-data.sql'
    with open(sql_path, 'r') as f:
        sql_content = f.read()

    # Find max ID from existing INSERTs
    id_matches = re.findall(r"INTO tiangong_package \(id,.*?VALUES \((\d+),", sql_content)
    max_sql_id = max(int(m) for m in id_matches) if id_matches else 250
    start_id = max_sql_id + 1
    print(f'SQL start ID: {start_id}')

    sql_inserts = generate_sql_inserts(skills, start_id)

    # Write SQL append file
    sql_append_path = Path(__file__).parent.parent / 'docs' / 'tiangong-superpowers-subskills.sql'
    with open(sql_append_path, 'w') as f:
        f.write("-- ============================================\n")
        f.write("-- Superpowers 子技能补充数据\n")
        f.write(f"-- 生成时间: 2026-06-02\n")
        f.write(f"-- 共 {len(skills)} 个子技能\n")
        f.write("-- 追加到 tiangong-init-data.sql 的 package/version 部分之后\n")
        f.write("-- ============================================\n\n")
        f.write("-- ============ Superpowers 子技能 Package ============\n")
        for stmt in sql_inserts:
            f.write(stmt + '\n')

    print(f'SQL append file: {sql_append_path}')
    print(f'Generated {len(sql_inserts)} SQL statements')

    # Print summary
    print('\n=== 子技能清单 ===')
    for s in skills:
        print(f'  skill-superpowers-{s["dir"]}: {s["name"]}')


if __name__ == '__main__':
    main()
