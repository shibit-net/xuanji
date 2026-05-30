#!/usr/bin/env python3
"""
将本地生成的 Skill ZIP 上传到天工坊后端文件存储。

用法:
  # 先登录获取 token
  TOKEN=$(curl -s -X POST https://test.shibit.net/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")

  # 上传（仅打印，不实际执行）
  python3 scripts/upload-skill-zips.py --env test --token "$TOKEN" --dry-run

  # 实际执行上传
  python3 scripts/upload-skill-zips.py --env test --token "$TOKEN"

  # 仅上传前 5 个（测试用）
  python3 scripts/upload-skill-zips.py --env test --token "$TOKEN" --limit 5
"""

import json
import os
import sys
import urllib.request
import urllib.error
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_DIR / "output" / "skills"

API_URLS = {
    "test": "https://test.shibit.net/api",
    "prod": "https://shibit.net/api",
}


def fetch_skills(api_base: str, token: str) -> dict:
    """从后端获取所有 Skill，建立 packageId → (dbId, versionId) 映射"""
    mapping = {}
    page = 1
    while True:
        url = f"{api_base}/tiangong/public/packages?type=2&page={page}&pageSize=100"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        skill_data = data.get("data", {}).get("skill", {})
        items = skill_data.get("list", [])
        if not items:
            break
        for item in items:
            mapping[item["packageId"]] = {
                "dbId": item["id"],
                "name": item["name"],
            }
        total_pages = skill_data.get("pages", 1)
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)

    print(f"Fetched {len(mapping)} skills from API")
    return mapping


def load_version_map() -> dict:
    """加载 packageId → versionId 映射"""
    vmap_path = OUTPUT_DIR / "version-map.json"
    if not vmap_path.exists():
        print(f"Warning: {vmap_path} not found")
        return {}
    with open(vmap_path) as f:
        return json.load(f)


def upload_zip(api_base: str, token: str, db_id: int, version_id: int,
               zip_path: Path, package_id: str) -> bool:
    """上传单个 ZIP 文件"""
    if not zip_path.exists():
        print(f"  ZIP not found: {zip_path}")
        return False

    url = f"{api_base}/tiangong/user/packages/{db_id}/versions/{version_id}/upload"
    boundary = "----FormBoundary7MA4YWxkTrZu0gW"

    with open(zip_path, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="skill.zip"\r\n'
        f"Content-Type: application/zip\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(url, data=body)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
        if result.get("success") or result.get("code") == 200:
            return True
        print(f"  API error: {result.get('message', 'unknown')}")
        return False
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.reason}")
        return False
    except Exception as e:
        print(f"  Upload error: {e}")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Upload Skill ZIPs to Tiangong Marketplace")
    parser.add_argument("--env", default="test", choices=["test", "prod"],
                        help="Target environment (default: test)")
    parser.add_argument("--token", required=True, help="JWT access token")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max skills to upload (0 = all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Only print what would be uploaded")
    args = parser.parse_args()

    api_base = API_URLS[args.env]

    # Fetch skill mapping from API
    print(f"Fetching skill list from {args.env}...")
    skill_map = fetch_skills(api_base, args.token)

    # Load version map
    version_map = load_version_map()

    # Match and upload
    success = 0
    failed = 0
    skipped = 0

    for package_id, vinfo in version_map.items():
        if args.limit > 0 and (success + failed) >= args.limit:
            break

        skill_info = skill_map.get(package_id)
        if not skill_info:
            print(f"SKIP {package_id}: not found in API")
            skipped += 1
            continue

        db_id = skill_info["dbId"]
        version_id = vinfo.get("versionId")
        if not version_id:
            print(f"SKIP {package_id}: no versionId in version-map.json")
            skipped += 1
            continue

        zip_path = OUTPUT_DIR / package_id / "skill.zip"
        name = skill_info["name"]

        if args.dry_run:
            print(f"WOULD UPLOAD: {package_id} ({name}) → dbId={db_id}, versionId={version_id}")
            success += 1
        else:
            print(f"Uploading: {package_id} ({name})...", end=" ", flush=True)
            if upload_zip(api_base, args.token, db_id, version_id, zip_path, package_id):
                print("OK")
                success += 1
            else:
                print("FAILED")
                failed += 1

        # Rate limiting
        if not args.dry_run:
            time.sleep(0.3)

    print(f"\nDone: {success} uploaded, {failed} failed, {skipped} skipped")


if __name__ == "__main__":
    main()
