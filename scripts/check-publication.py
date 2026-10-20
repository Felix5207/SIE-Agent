#!/usr/bin/env python3
"""Check tracked/unignored files, or the Git index with --staged.

Reports file names and rule names only, never matched credentials.
This is a release guard, not a replacement for reviewing newly added content.
"""
import argparse
import re
import subprocess
import sys
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, BadZipFile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--staged", action="store_true", help="Inspect exact index contents")
args = parser.parse_args()

command = ["git", "ls-files", "-z", "--cached"]
if not args.staged:
    command += ["--others", "--exclude-standard"]
paths = sorted(set(subprocess.check_output(command, cwd=ROOT).decode().split("\0")) - {""})
forbidden_dirs = {
    "data", "outputs", "backups", "uploads", "exports", "sessions", "node_modules",
    "dist", ".venv", "venv", ".codex", ".pi", "__pycache__", "screenshots",
}
forbidden_names = {"connections.json", "auth.json", "models.json", "models-store.json"}
forbidden_suffixes = {
    ".sqlite", ".db", ".log", ".pem", ".key", ".p12", ".pfx",
    ".zip", ".tar", ".tgz", ".gz", ".pyc", ".ppt", ".pptx", ".doc", ".docx",
}
patterns = {
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "provider credential": rb"\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b",
    "GitHub credential": rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b",
    "AWS access ID": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "JWT credential": rb"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b",
    "academic domain": rb"\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(?:edu(?:\.[a-z]{2})?|ac\.[a-z]{2})\b",
    "machine-specific home path": rb"/(?:nvme|home|Users)/[A-Za-z0-9_.-]+/",
}
rules = {name: re.compile(pattern) for name, pattern in patterns.items()}
failures = []
for name in paths:
    rel = PurePosixPath(name)
    if (
        set(rel.parts) & forbidden_dirs
        or rel.name in forbidden_names
        or rel.name.startswith(".env") and rel.name != ".env.example"
        or rel.suffix in forbidden_suffixes
        or ".sqlite-" in rel.name
    ):
        failures.append((name, "private/runtime file"))
    file = ROOT / name
    if args.staged:
        entry = subprocess.check_output(["git", "ls-files", "-s", "--", name], cwd=ROOT)
        if entry.startswith(b"120000"):
            failures.append((name, "symlink"))
            continue
        content = subprocess.check_output(["git", "show", f":{name}"], cwd=ROOT)
    else:
        if file.is_symlink():
            failures.append((name, "symlink"))
            continue
        if not file.is_file():
            continue
        content = file.read_bytes()
    parts = [content]
    if rel.suffix == ".xlsx":
        if name != "examples/extraction-template.xlsx":
            failures.append((name, "unreviewed workbook"))
        try:
            with ZipFile(BytesIO(content)) as archive:
                parts += [archive.read(item) for item in archive.namelist()]
        except BadZipFile:
            failures.append((name, "invalid workbook"))
    if rel.suffix == ".pdf" and name != "examples/synthetic-study.pdf":
        failures.append((name, "unreviewed PDF"))
    for label, pattern in rules.items():
        if any(pattern.search(part) for part in parts):
            failures.append((name, label))

for name, label in failures:
    print(f"FAIL {name}: {label}", file=sys.stderr)
if failures:
    raise SystemExit(1)
print(f"Publication guard passed: {len(paths)} files checked; no matched forbidden paths or patterns.")
