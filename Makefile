ENV_DIR ?= cloud/deploy-config/env-files
export ENV_DIR

.DEFAULT_GOAL := help
.PHONY: help run app web web-local stop test-e2e

help:
	@echo "make run app    build the Mac app (DMG) from this checkout and open it (Docker must be running)"
	@echo "make run web    run the hosted stack locally (agent, web, search, renderer) at http://localhost:18300"
	@echo "make run web-local  run M7 locally on a local Supabase (oab-m7-dev) at http://localhost:18721 with printed sign-in links; no env files needed"
	@echo "make stop       stop the hosted preview (oab-preview; volumes kept), web-local (its stack and data removed) and the Mac app's services"
	@echo "make test-e2e   run the end-to-end tests locally (~15 min): the Mac app with a fake and a real Docker, and the hosted preview smoke when its env files exist"
	@echo "make help       show this list"
	@echo "make app, make web and make web-local work without run. Env files: cloud/deploy-config/env-files/{backend,frontend,ops}/.env"

run:
	@$(if $(filter-out run,$(MAKECMDGOALS)),:,$(MAKE) --no-print-directory help)

app:
	@bash scripts/make/app.sh

web:
	@bash scripts/make/web.sh

web-local:
	@bash scripts/make/web-local.sh

stop:
	@bash scripts/make/stop.sh

test-e2e:
	@bash scripts/make/test-e2e.sh
