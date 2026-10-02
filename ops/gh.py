#!/usr/bin/env python3
"""GitHub via authd surrogate (custom.github).
Usage:
  gh.py user
  gh.py create-repo <name> [--private]
  gh.py push <owner> <repo> <dir>   # uploads working tree via Contents API
"""
import sys, json, base64, os, urllib.request, urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

API = "https://api.github.com"
CRED = "custom.github"
HOSTS = ("api.github.com",)

SKIP = {".git", "__pycache__", "venv", ".venv", "node_modules"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        r.add_header("Content-Type", "application/json")
    add_surrogate_to_request(r, CRED, allowed_hosts=HOSTS)
    try:
        resp = urllib.request.urlopen(r, timeout=90)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"GitHub {method} {path} -> HTTP {e.code}: {detail}")
    if resp.status == 204:
        return {}
    return read_json_response(resp)


def cmd_user():
    u = req("GET", "/user")
    print(json.dumps({"login": u["login"], "id": u["id"]}, indent=1))


def cmd_create_repo(name, private=False):
    r = req("POST", "/user/repos", {"name": name, "private": private,
                                    "auto_init": False,
                                    "description": "Sur - music player (ytmusicapi + yt-dlp)"})
    print(json.dumps({"full_name": r["full_name"], "html_url": r["html_url"],
                      "clone_url": r["clone_url"], "default_branch": r.get("default_branch")}, indent=1))


def cmd_push(owner, repo, root):
    root = os.path.abspath(root)
    files = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP]
        for f in fn:
            if f.endswith(".pyc"):
                continue
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            files.append((rel, full))
    files.sort()
    for rel, full in files:
        with open(full, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        try:
            cur = req("GET", f"/repos/{owner}/{repo}/contents/{rel}")
            sha = cur.get("sha")
        except RuntimeError as e:
            if "HTTP 404" not in str(e):
                raise
            sha = None
        body = {"message": f"Sur deploy: {rel}", "content": b64}
        if sha:
            body["sha"] = sha
        req("PUT", f"/repos/{owner}/{repo}/contents/{rel}", body)
        print(f"uploaded {rel} ({len(b64) * 3 // 4} bytes)")
    print(f"OK: {len(files)} files -> https://github.com/{owner}/{repo}")


if __name__ == "__main__":
    c = sys.argv[1]
    if c == "user":
        cmd_user()
    elif c == "create-repo":
        cmd_create_repo(sys.argv[2], "--private" in sys.argv)
    elif c == "push":
        cmd_push(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit("unknown cmd")
