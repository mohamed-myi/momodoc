VENV_DIR := backend/.venv
VENV_BIN := $(VENV_DIR)/bin
PYTHON   := $(VENV_BIN)/python
PIP      := $(VENV_BIN)/pip

.PHONY: momo-install dev dev-desktop build-desktop package-desktop serve stop status test clean help

$(VENV_DIR):  ## Create Python virtual environment
	python3 -m venv $(VENV_DIR)

momo-install: $(VENV_DIR)  ## Install backend and desktop dependencies
	$(PIP) install -e "backend/.[dev]"
	cd desktop && npm install

dev: $(VENV_DIR)  ## Start backend with auto-reload (development mode)
	cd backend && $(CURDIR)/$(VENV_BIN)/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

dev-desktop:  ## Start Electron desktop app in dev mode (requires backend running)
	cd desktop && npm run dev

build-desktop:  ## Build desktop app bundles (compile only; no installer)
	cd desktop && npm run build

package-desktop:  ## Package desktop app for current platform (installer/archive)
	cd desktop && npm run package:current

serve: $(VENV_DIR)  ## Start the momodoc server
	$(VENV_BIN)/momodoc serve

stop: $(VENV_DIR)  ## Stop a running momodoc instance
	$(VENV_BIN)/momodoc stop

status: $(VENV_DIR)  ## Check if momodoc is running
	$(VENV_BIN)/momodoc status

test: $(VENV_DIR)  ## Run backend tests
	cd backend && $(CURDIR)/$(VENV_BIN)/pytest

clean:  ## Remove all data (requires confirmation)
	$(VENV_BIN)/momodoc stop 2>/dev/null || true
	@set -e; \
	if [ "$(CLEAN_CONFIRM)" = "delete" ]; then \
		confirm="delete"; \
	elif [ -t 0 ]; then \
		printf "This permanently deletes all momodoc data. Type 'delete' to continue: "; \
		read confirm; \
	else \
		echo "Refusing to run clean non-interactively without CLEAN_CONFIRM=delete"; \
		exit 1; \
	fi; \
	if [ "$$confirm" != "delete" ]; then \
		echo "Clean aborted."; \
		exit 1; \
	fi; \
	data_dir="$$($(PYTHON) -c "from platformdirs import user_data_dir; print(user_data_dir('momodoc'))")"; \
	rm -rf "$$data_dir"; \
	echo "Deleted $$data_dir"

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'
