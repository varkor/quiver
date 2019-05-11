.PHONY: all gh-pages

# Ensure `cd` works properly by forcing everything to be executed in a single shell.
.ONESHELL:

# Build KaTeX.
all:
	git submodule update --init --recursive
	cd src/KaTeX
	yarn
	yarn build

# Update the quiver GitHub Pages application.
gh-pages:
	git subtree push --prefix src origin pre-gh-pages
	git worktree add ../quiver-worktree pre-gh-pages
	cd ../quiver-worktree
	git pull
	git checkout gh-pages
	git rebase pre-gh-pages
	git push --force
	cd ../quiver
	git worktree remove ../quiver-worktree
