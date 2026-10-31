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
	@echo " Akun Demo (klik tombol 'Isi Form' di halaman login):"
	@echo " - Requester: requester@sigap.local (Password: demo123)"
	@echo " - Agent:     agent@sigap.local     (Password: demo123)"
	@echo " - Team Lead: lead@sigap.local      (Password: demo123)"
	@echo " - Admin:     admin@sigap.local     (Password: demo123)"
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

