# Rewind — parallel-dev shortcuts for the frontend/backend worktree flow.
# See docs/API_CONTRACT.md §5. Run `make` or `make help` for the list.
.PHONY: help sync integrate serve test

help: ## Show this list
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | sed -E 's/:[^#]*## / — /' | sort

sync: ## (work worktree) Rebase this branch onto the latest main
	@[ "$$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "Run 'make sync' from a work worktree, not main."; exit 1; }
	-git fetch origin --quiet
	git rebase main

integrate: ## (main worktree) Merge both work branches into main, then run backend tests
	@[ "$$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Run 'make integrate' from the main worktree."; exit 1; }
	git merge work/backend
	git merge work/frontend
	cd backend && uv run pytest -q

serve: ## Run the single backend server on :8000 (frees a stale one first)
	-fuser -k 8000/tcp
	uv run --project backend uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000

test: ## Backend compile check + pytest (no browser needed)
	cd backend && uv run python -m py_compile main.py metrics.py routers/*.py && uv run pytest -q
