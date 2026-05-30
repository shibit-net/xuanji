#!/usr/bin/env python3
"""
删除 64 个虚假 Skill 从数据库。

用法:
  python3 scripts/delete-fake-skills.py --env test --token "$ADMIN_TOKEN" --dry-run
  python3 scripts/delete-fake-skills.py --env test --token "$ADMIN_TOKEN"
"""

import json
import sys
import urllib.request
import urllib.error
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent

API_URLS = {
    "test": "https://test.shibit.net/api",
    "prod": "https://shibit.net/api",
}

# 64 个 SKILL.md < 1KB 的虚假 skill
FAKE_PACKAGE_IDS = [
    "skill-find-skills", "skill-grill-me", "skill-skill-creator",
    "skill-compound-engineering", "skill-incremental-tdd", "skill-deep-codebase-audit",
    "skill-claude-mem", "skill-claude-self-reflect", "skill-recursive-context",
    "skill-agent-browser", "skill-autoresearch", "skill-agentic-ml",
    "skill-scientific-agent", "skill-ui-ux-pro-max", "skill-webgpu",
    "skill-swiftui-agent", "skill-dotnet-skills", "skill-vercel-react",
    "skill-baoyu-skills", "skill-gstack", "skill-anthropic-official",
    "skill-vercel-skills-cli", "skill-openai-codex", "skill-trailofbits-security",
    "skill-kdense-scientific", "skill-remotion-video", "skill-garden-skills",
    "skill-wshobson-agents", "skill-microsoft-dev-skills", "skill-google-cloud-skills",
    "skill-langchain-agent", "skill-prisma-db", "skill-storybook-ui",
    "skill-rust-dev", "skill-golang-dev", "skill-terraform-iac",
    "skill-python-ml", "skill-mobile-dev", "skill-docker-k8s",
    "skill-api-design", "skill-blockchain-web3", "skill-testing-qa",
    "skill-performance-optimization", "skill-observability-monitoring",
    "skill-ci-cd-pipeline", "skill-figma-to-code", "skill-documentation-generator",
    "skill-accessibility-a11y", "skill-react-native-expo", "skill-supabase-backend",
    "skill-redis-caching", "skill-tailwindcss", "skill-nestjs-backend",
    "skill-django-backend", "skill-spring-boot", "skill-electron-desktop",
    "skill-nextjs-fullstack", "skill-ai-code-review", "skill-postgresql-expert",
    "skill-graphql-api", "skill-devsecops", "skill-vim-neovim",
    "skill-unity-game-dev", "skill-linux-shell",
]


def fetch_db_ids(api_base: str) -> dict:
    """从公开 API 获取 packageId → dbId 映射"""
    mapping = {}
    page = 1
    while True:
        url = f"{api_base}/tiangong/public/packages?type=2&page={page}&pageSize=100"
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read())
        items = data.get("data", {}).get("skill", {}).get("list", [])
        if not items:
            break
        for item in items:
            mapping[item["packageId"]] = item["id"]
        pages = data.get("data", {}).get("skill", {}).get("pages", 1)
        if page >= pages:
            break
        page += 1
        time.sleep(0.1)
    return mapping


def delete_package(api_base: str, token: str, db_id: int, package_id: str) -> bool:
    """调用 DELETE /api/tiangong/admin/packages/{id}"""
    url = f"{api_base}/tiangong/admin/packages/{db_id}"
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        if result.get("success") or result.get("code") == 200:
            return True
        print(f"  API error: {result.get('message', 'unknown')}")
        return False
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.reason}")
        return False
    except Exception as e:
        print(f"  Error: {e}")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="删除数据库中的虚假 Skill")
    parser.add_argument("--env", default="test", choices=["test", "prod"])
    parser.add_argument("--token", required=True, help="Admin JWT token")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    api_base = API_URLS[args.env]

    print(f"Fetching skill list from {args.env}...")
    id_map = fetch_db_ids(api_base)
    print(f"Found {len(id_map)} skills in database")

    found = 0
    missing = 0
    success = 0
    failed = 0

    for pid in FAKE_PACKAGE_IDS:
        db_id = id_map.get(pid)
        if not db_id:
            print(f"SKIP {pid}: not in database")
            missing += 1
            continue
        found += 1

        if args.dry_run:
            print(f"WOULD DELETE: {pid} (dbId={db_id})")
            success += 1
        else:
            print(f"Deleting: {pid} (dbId={db_id})...", end=" ", flush=True)
            if delete_package(api_base, args.token, db_id, pid):
                print("OK")
                success += 1
            else:
                print("FAILED")
                failed += 1
            time.sleep(0.2)

    print(f"\nDone: {success} deleted, {failed} failed, {missing} not found")


if __name__ == "__main__":
    main()
