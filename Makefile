.PHONY: dev-db dev-backend dev-frontend prod-up prod-down logs clean

# --- Development ---
dev-db:
	docker compose up -d db

dev-backend:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev: dev-db
	@echo "DB started. Now run 'make dev-backend' and 'make dev-frontend' in separate terminals."

# --- Production ---
prod-up:
	docker compose -f docker-compose.prod.yml --env-file .env up -d --build

prod-down:
	docker compose -f docker-compose.prod.yml down

logs:
	docker compose -f docker-compose.prod.yml logs -f

# --- Utilities ---
clean:
	docker compose down -v
	docker compose -f docker-compose.prod.yml down -v
