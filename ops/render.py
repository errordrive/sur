#!/usr/bin/env python3
"""Render via authd surrogate (custom.render).
Usage:
  render.py owners
  render.py create-service <ownerId> <repoUrl>
  render.py service <serviceId>
  render.py deploys <serviceId>
  render.py add-domain <serviceId> <domain>
  render.py domains <serviceId>
"""
import sys, json, time, urllib.request, urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

API = "https://api.render.com/v1"
CRED = "custom.render"
HOSTS = ("api.render.com",)


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Accept", "application/json")
    if data:
        r.add_header("Content-Type", "application/json")
    add_surrogate_to_request(r, CRED, allowed_hosts=HOSTS)
    try:
        resp = urllib.request.urlopen(r, timeout=90)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        raise RuntimeError(f"Render {method} {path} -> HTTP {e.code}: {detail}")
    if resp.status in (200, 201):
        return read_json_response(resp)
    return {"status": resp.status}


def cmd_owners():
    for o in req("GET", "/owners"):
        o = o.get("owner", o)
        print(o.get("id"), o.get("name"), o.get("email", ""))


def cmd_create_service(owner_id, repo_url):
    body = {
        "type": "web_service",
        "name": "sur",
        "ownerId": owner_id,
        "repo": repo_url,
        "branch": "main",
        "autoDeployTrigger": "commit",
        "serviceDetails": {
            "runtime": "python",
            "buildCommand": "pip install -r requirements.txt",
            "startCommand": "gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120",
            "plan": "free",
            "healthCheckPath": "/api/health",
        },
        "envVars": [{"key": "PYTHON_VERSION", "value": "3.11.9"}],
    }
    s = req("POST", "/services", body)
    svc = s.get("service", s)
    print(json.dumps({"id": svc.get("id"), "name": svc.get("name"),
                      "url": (svc.get("serviceDetails") or {}).get("url")}, indent=1))


def cmd_service(sid):
    s = req("GET", f"/services/{sid}").get("service", {})
    d = s.get("serviceDetails") or {}
    print(json.dumps({"id": s.get("id"), "name": s.get("name"), "suspended": s.get("suspended"),
                      "url": d.get("url"), "buildCommand": d.get("buildCommand")}, indent=1))


def cmd_deploys(sid):
    ds = req("GET", f"/services/{sid}/deploys?limit=3")
    for dep in ds:
        d = dep.get("deploy", dep)
        print(d.get("id"), d.get("status"), d.get("createdAt"))


def cmd_add_domain(sid, domain):
    out = req("POST", f"/services/{sid}/custom-domains", {"name": domain})
    print(json.dumps(out, indent=1)[:800])


def cmd_domains(sid):
    for c in req("GET", f"/services/{sid}/custom-domains"):
        c = c.get("customDomain", c)
        print(c.get("name"), "| verified:", c.get("verificationStatus"))


if __name__ == "__main__":
    c = sys.argv[1]
    if c == "owners":
        cmd_owners()
    elif c == "create-service":
        cmd_create_service(sys.argv[2], sys.argv[3])
    elif c == "service":
        cmd_service(sys.argv[2])
    elif c == "deploys":
        cmd_deploys(sys.argv[2])
    elif c == "add-domain":
        cmd_add_domain(sys.argv[2], sys.argv[3])
    elif c == "domains":
        cmd_domains(sys.argv[2])
    else:
        sys.exit("unknown cmd")
