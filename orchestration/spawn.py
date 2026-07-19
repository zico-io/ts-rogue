#!/usr/bin/env python3
import os
import runpy
from pathlib import Path

botfiles = Path(os.environ.get("BOTFILES_HOME", Path.home() / ".botfiles"))
spawn = botfiles / "orchestration" / "spawn.py"
if not spawn.is_file():
    raise SystemExit(f"portable harness not found: {spawn} (set BOTFILES_HOME)")
runpy.run_path(spawn, run_name="__main__")
