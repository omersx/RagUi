# Contributing to RagUi

Thanks for your interest in improving RagUi! 🎉 (No emojis in code, but enthusiasm here is fine.)

## Getting started

```bash
# 1. Clone and bootstrap (creates venv, installs backend + frontend deps)
git clone https://github.com/<your-username>/RagUi.git
cd RagUi
npm run setup

# 2. Run everything (db + backend + frontend with prefixed logs)
npm run dev
```

Docker Desktop must be running for the Postgres container. Optional local LLM support via [Ollama](https://ollama.com) — everything also works with API providers.

## Development workflow

1. Fork the repo and create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes.
3. Verify before pushing:
   ```bash
   npm run test:backend    # pytest suite
   npm run typecheck       # frontend TypeScript
   cd frontend && npm run build   # production build must pass
   ```
4. Open a Pull Request with a clear description of what changed and why.

The CI workflow runs the backend tests and the frontend typecheck/build on every PR — it must be green before merge.

## Guidelines

- **Backend**: Python 3.12, FastAPI, asyncpg. Keep routers thin, logic in `services/`, and never interpolate user input into SQL (see `utils/model_registry.py` for the sanitization pattern).
- **Frontend**: Next.js 14 App Router, TypeScript strict mode, Tailwind, Zustand stores. Keep components typed; no `any`.
- **Commits**: short imperative subject lines (`add hybrid-search weights to settings`, not `fixed stuff`).
- **Secrets**: never commit `.env`, keys, or tokens. Configuration flows exclusively through environment variables (see `.env.example`).

## Reporting bugs

Open an issue with your OS, Docker version, relevant logs (`docker compose logs`), and steps to reproduce. For security issues, see [SECURITY.md](SECURITY.md) — please do not open public issues for vulnerabilities.
