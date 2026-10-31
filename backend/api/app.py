"""FastAPI app: calc, project and report endpoints; serves frontend/ at /.

Run:  uvicorn api.app:app --port 8770   (from backend/, or tools/dev.ps1)

POST requests are accepted only with a loopback Host header and, if an Origin header is
sent, a same-origin Origin (403 {ok:false, error:"forbidden"} otherwise).
"""
from __future__ import annotations

import pathlib
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from gerotor_core import InvalidDesignError

from . import cache, calc, exports, project, report
from .units import UnitError
from .serialize import to_json

app = FastAPI(title="Gerotor API", version=report.API_VERSION)
FRONTEND = pathlib.Path(__file__).resolve().parents[2] / "frontend"


@app.exception_handler(InvalidDesignError)
def _invalid(_req, exc: InvalidDesignError):
    return JSONResponse(status_code=422, content={"error": "InvalidDesign", "reason": exc.reason,
                                                  "checks": to_json(exc.checks)})


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _host_ok(host: str | None) -> bool:
    try:
        return bool(host) and urlsplit("//" + host).hostname in LOCAL_HOSTS
    except ValueError:
        return False


@app.middleware("http")
async def local_only(request: Request, call_next):
    """Origin/Host guard for state-changing requests: Host must be a loopback name (blocks DNS
    rebinding) and a present Origin must be same-origin (blocks cross-site POSTs)."""
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        host = request.headers.get("host")
        origin = request.headers.get("origin")
        bad = not _host_ok(host)
        if not bad and origin is not None:
            o = urlsplit(origin)
            bad = o.scheme not in ("http", "https") or o.netloc != host
        if bad:
            return JSONResponse(status_code=403, content={"ok": False, "error": "forbidden"})
    return await call_next(request)


@app.exception_handler(UnitError)
def _bad_unit(_req, exc: UnitError):
    return JSONResponse(status_code=422, content={"error": "InvalidUnit", "reason": str(exc)})


@app.exception_handler(project.ProjectError)
def _bad_project(_req, exc: project.ProjectError):
    return JSONResponse(status_code=422, content={"error": "InvalidProject", "reason": str(exc),
                                                  "errors": exc.errors})


@app.get("/api/health")
def health():
    return {"status": "ok", "version": report.API_VERSION, **report.software(),
            "modules": list(calc.MODULES), "projectSchema": project.SCHEMA_ID, "cache": cache.info()}


def _calc(body, modules, arrays):
    if isinstance(body, dict) and "schema" in body:
        body = project.load(body)
    out = to_json(cache.cached_run(body, modules), arrays=arrays)
    out["inputHash"] = project.resolved_hash(calc.resolved_inputs(body))
    out["documentHash"] = project.input_hash(body if "design" in body else {"design": body})
    out["software"] = report.software()
    return out


@app.post("/api/calc/all")
def calc_all(body: dict = Body(...), arrays: bool = Query(True)):
    return _calc(body, None, arrays)


@app.post("/api/calc/{module}")
def calc_module(module: str, body: dict = Body(...), arrays: bool = Query(True)):
    if module not in calc.MODULES:
        return JSONResponse(status_code=404, content={"error": "UnknownModule", "reason": module,
                                                      "modules": list(calc.MODULES)})
    return _calc(body, [module], arrays)


def _methods_payload(settings=None):
    from . import methods as M
    _i, s, v, _o, _m = calc.split_request({"design": {}, "settings": settings or {}})
    return {"projectSchema": project.SCHEMA_ID, "software": report.software(),
            "variants": to_json(v), "variantDefaults": to_json(calc.VARIANT_DEFAULTS),
            "assumptions": to_json(M.assumptions(v, calc.VARIANT_DEFAULTS)), "methods": report.methods()}


@app.get("/api/methods")
def methods_get():
    """METHODS registry + assumption IDs (A-Dx) with statement, active variant (default settings), sources."""
    return _methods_payload()


@app.post("/api/methods")
def methods_post(body: dict = Body(...)):
    """Same as GET, active variants from {settings} or a project document."""
    if isinstance(body, dict) and "schema" in body:
        body = project.load(body)
    return _methods_payload((body or {}).get("settings"))


@app.get("/api/criteria/profiles")
def criteria_profiles():
    """Acceptance-criteria profiles (all limits empty), material library, quantity keys, statement."""
    from . import criteria
    return to_json(criteria.catalogue())


@app.get("/api/project/schema")
def project_schema():
    return project._SCHEMA


@app.post("/api/project/validate")
def project_validate(body: dict = Body(...)):
    doc = project.migrate(body)
    errs = project.validate(doc)
    return {"valid": not errs, "errors": errs, "migratedFrom": project.version_of(body),
            "project": doc, "inputHash": project.input_hash(doc), "resultsStale": project.results_stale(doc)}


@app.post("/api/report/data")
def report_data(body: dict = Body(...)):
    if isinstance(body, dict) and "schema" in body:
        body = project.load(body)
    return report.build(body)


def _xreq(request: Request):
    """serve.ps1 contract: X-Gerotor-Request: 1 required (forces a CORS preflight cross-site)."""
    if request.headers.get("x-gerotor-request") != "1":
        return JSONResponse(status_code=403, content={"ok": False, "error": "forbidden"})
    return None


@app.post("/api/save")
def save(request: Request, body: dict = Body(...)):
    """{files: {name: text}, base64: {name: b64}} -> <repo>/exports/ (same contract as tools/serve.ps1)."""
    return _xreq(request) or exports.save(body)


@app.post("/api/modelica")
def modelica(request: Request, body: dict = Body(...)):
    """{name, files: {file: text}, open, check} -> <repo>/modelica/<name>/ (same contract as serve.ps1)."""
    return _xreq(request) or exports.modelica(body)


if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
