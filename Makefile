.PHONY: up up-build down reset logs backup restore deploy dev test lint typecheck

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

reset:
	docker compose down -v
	$(MAKE) up

logs:
	docker compose logs -f web worker

backup:
	./scripts/backup.sh

restore:
	./scripts/restore.sh $(FILE)

deploy:
	./scripts/deploy.sh $(or $(VERSION),v1.0.0)

dev:
	docker compose -f docker-compose.dev.yml up -d
	pnpm dev

test:
	pnpm lint
	pnpm typecheck
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

