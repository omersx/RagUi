# Windows dev script — run from backend/ directory
if (Test-Path ".\.venv\Scripts\Activate.ps1") { . .\.venv\Scripts\Activate.ps1 }
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
