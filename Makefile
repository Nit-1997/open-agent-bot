ENV_DIR ?= cloud/deploy-config/env-files
export ENV_DIR

.DEFAULT_GOAL := help
.PHONY: help run app web stop

help:
	@echo "make run app    build the Mac app (DMG) from this checkout and open it (Docker must be running)"
	@echo "make run web    run the hosted stack locally (agent, web, search, renderer) at http://localhost:18300"
	@echo "make stop       stop the hosted preview (oab-preview) and the Mac app's services; volumes are kept"
	@echo "make help       show this list"
	@echo "make app and make web work without run. Env files: cloud/deploy-config/env-files/{backend,frontend,ops}/.env"

run:
	@$(if $(filter-out run,$(MAKECMDGOALS)),:,$(MAKE) --no-print-directory help)

app:
	@bash scripts/make/app.sh

web:
	@bash scripts/make/web.sh

stop:
	@bash scripts/make/stop.sh
