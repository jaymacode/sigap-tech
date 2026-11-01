.PHONY: up up-build down reset logs psql backup restore deploy dev test test-db test-docker lint typecheck

# Database untuk tes integrasi Postgres (tests/db). Dapat ditimpa: make test-db TEST_DATABASE_URL=...
TEST_DATABASE_URL ?= postgres://postgres:postgres@localhost:5432/sigap_test

up:
	docker compose up -d
	@echo "Menunggu Sigap siap..."
	@until curl -sf http://localhost:$${SIGAP_PORT:-3000}/api/health > /dev/null 2>&1; do sleep 1; done
	@echo ""
	@echo "=========================================================="
	@echo " Sigap IT Service Desk siap digunakan!"
	@echo " Web UI:     http://localhost:$${SIGAP_PORT:-3000}"
	@echo " Mailpit:    http://localhost:$${MAILPIT_PORT:-8025}"
	@echo " MinIO:      http://localhost:$${MINIO_CONSOLE_PORT:-9001}"
	@echo ""
	@echo " Akun Demo (1-Click Login di halaman login):"
	@echo " - Requester: user@sigap.demo  (Password: Demo1234!)"
	@echo " - Agent:     agent@sigap.demo (Password: Demo1234!)"
	@echo " - Team Lead: lead@sigap.demo  (Password: Demo1234!)"
	@echo " - Admin:     admin@sigap.demo (Password: Demo1234!)"
	@echo "=========================================================="

up-build:
	docker compose up -d --build

down:
	docker compose down

# Hapus volume (data Postgres ikut hilang) lalu nyalakan ulang dari nol.
reset:
	docker compose down -v
	$(MAKE) up

logs:
	docker compose logs -f web worker

# Buka psql interaktif di container db (stack utama, docker-compose.yml).
psql:
	docker compose exec db psql -U postgres -d sigap

backup:
	./scripts/backup.sh

restore:
	./scripts/restore.sh $(FILE)

deploy:
	./scripts/deploy.sh $(or $(VERSION),v1.0.0)

dev:
	docker compose -f docker-compose.dev.yml up -d
	pnpm dev

# Tes integrasi Postgres dari host: Postgres dev (docker-compose.dev.yml) + database sigap_test.
# Database sigap tidak pernah dipakai untuk tes destruktif.
test-db:
	docker compose -f docker-compose.dev.yml up -d --wait db
	@if [ "$$(docker compose -f docker-compose.dev.yml exec -T db psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='sigap_test'" | tr -d '\r')" != "1" ]; then \
		docker compose -f docker-compose.dev.yml exec -T db psql -U postgres -c "CREATE DATABASE sigap_test"; \
	fi
	TEST_DATABASE_URL=$(TEST_DATABASE_URL) pnpm test:db

# Semua tes (unit + integrasi Postgres) di dalam container, tanpa Node/pnpm di host.
test-docker:
	docker compose --profile test run --rm test

test:
	pnpm lint
	pnpm typecheck
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck
