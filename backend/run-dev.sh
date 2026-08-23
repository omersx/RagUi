#!/usr/bin/env bash
# Dev convenience script — activate venv + run uvicorn with reload
if [ -f .venv/bin/activate ]; then source .venv/bin/activate; fi
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
