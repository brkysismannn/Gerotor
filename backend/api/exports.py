"""File export endpoints ported from tools/serve.ps1 (/api/save, /api/modelica).

Contract (unchanged from serve.ps1):
  POST /api/save      {files: {name: text}, base64: {name: b64}}
                      -> 200 {ok: true, dir, files: [written paths]}   into <repo>/exports/
                      allowed extensions .step .stp .pdf .dxf .svg .csv .xlsx .txt
  POST /api/modelica  {name, files: {file: text}, open: bool, check: bool}
                      -> 200 {ok: true, dir, files, openModelica, [check], [opened], [error]}
                      into <repo>/modelica/<name>/, extensions .mo .mos .csv .txt;
                      check runs omc checkModel(<name>_System), open starts OMEdit.
Header X-Gerotor-Request: 1 is required (checked in app.py), otherwise 403 {ok:false, error:"forbidden"}.
Files with a disallowed extension are silently skipped (as in serve.ps1). Bad base64 -> 400.

Path-traversal protection: names are sanitised like serve.ps1 (characters outside
[A-Za-z0-9_.-] -> "_", directory name [A-Za-z0-9_]), leading dots are stripped, and the resolved
target must lie directly inside the target directory.
"""
from __future__ import annotations

import base64
import binascii
import glob
import os
import pathlib
import re
import subprocess

from fastapi.responses import JSONResponse

REPO = pathlib.Path(__file__).resolve().parents[2]
EXPORTS_DIR = REPO / "exports"
MODELICA_DIR = REPO / "modelica"
SAVE_EXT = re.compile(r"\.(step|stp|pdf|dxf|svg|csv|xlsx|txt)$")
MODELICA_EXT = re.compile(r"\.(mo|mos|csv|txt)$")


def safe_name(name: str, allowed: re.Pattern) -> str | None:
    f = re.sub(r"[^A-Za-z0-9_.-]", "_", str(name)).lstrip(".")
    return f if f and allowed.search(f) else None


def _target(d: pathlib.Path, fname: str) -> pathlib.Path:
    path = (d / fname).resolve()
    if path.parent != d.resolve():
        raise ValueError(f"path outside target directory: {fname}")
    return path


def _bad(msg):
    return JSONResponse(status_code=400, content={"ok": False, "error": msg})


def save(body: dict):
    d = EXPORTS_DIR
    files, b64 = body.get("files") or {}, body.get("base64") or {}
    if not isinstance(files, dict) or not isinstance(b64, dict):
        return _bad("files/base64 must be objects")
    d.mkdir(parents=True, exist_ok=True)
    written = []
    for name, text in files.items():
        f = safe_name(name, SAVE_EXT)
        if f:
            p = _target(d, f)
            p.write_text(str(text), encoding="utf-8", newline="")
            written.append(str(p))
    for name, data in b64.items():
        f = safe_name(name, SAVE_EXT)
        if f:
            try:
                raw = base64.b64decode(str(data), validate=True)
            except (binascii.Error, ValueError):
                return _bad(f"invalid base64 for {name}")
            p = _target(d, f)
            p.write_bytes(raw)
            written.append(str(p))
    return {"ok": True, "dir": str(d), "files": written}


def find_openmodelica() -> str | None:
    cands = [os.environ["OPENMODELICAHOME"]] if os.environ.get("OPENMODELICAHOME") else []
    cands += sorted(glob.glob(r"C:\Program Files\OpenModelica*"), reverse=True)
    for c in cands:
        if (pathlib.Path(c) / "bin" / "OMEdit.exe").exists():
            return c
    return None


def modelica(body: dict, run_tools: bool = True):
    name = re.sub(r"[^A-Za-z0-9_]", "_", str(body.get("name") or "")) or "GerotorPump"
    files = body.get("files") or {}
    if not isinstance(files, dict):
        return _bad("files must be an object")
    d = MODELICA_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    written = []
    for fname, text in files.items():
        f = safe_name(fname, MODELICA_EXT)
        if f:
            p = _target(d, f)
            p.write_text(str(text), encoding="utf-8", newline="")
            written.append(str(p))
    om = find_openmodelica() if run_tools else None
    result = {"ok": True, "dir": str(d), "files": written, "openModelica": om}
    mo = d / f"{name}.mo"
    sysmo = d / f"{name}_System.mo"
    if body.get("check") and om and mo.exists():
        script = d / "check.mos"
        fwd = lambda p: str(p).replace("\\", "/")  # noqa: E731
        script.write_text(f'loadModel(Modelica, {{"4.1.0"}}); getErrorString();\nloadFile("{fwd(mo)}"); getErrorString();\n'
                          f'loadFile("{fwd(sysmo)}"); getErrorString();\ncheckModel({name}_System); getErrorString();',
                          encoding="ascii")
        try:
            r = subprocess.run([str(pathlib.Path(om) / "bin" / "omc.exe"), str(script)], capture_output=True,
                               text=True, timeout=300)
            result["check"] = r.stdout + r.stderr
        except (OSError, subprocess.SubprocessError) as exc:
            result["check"] = f"omc failed: {exc}"
    if body.get("open"):
        if om and mo.exists():
            args = [str(mo)] + ([str(sysmo)] if sysmo.exists() else [])
            subprocess.Popen([str(pathlib.Path(om) / "bin" / "OMEdit.exe"), *args])
            result["opened"] = True
        else:
            result["opened"] = False
            result["error"] = "OpenModelica (OMEdit) not found"
    return result
