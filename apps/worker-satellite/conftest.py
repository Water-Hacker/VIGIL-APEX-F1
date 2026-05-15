"""Per-worker pytest rootdir anchor.

Presence of this file (alongside the worker's `tests/` package) gives pytest
a worker-local rootpath, which lets the `tests` package live in two workers
without colliding on `sys.modules['tests']` during collection.

See pytest docs: "rootdir, configfile, and inipath" and the discussion of
"package collision" when two `tests/` dirs share a parent rootdir.
"""
