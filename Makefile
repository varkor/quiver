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
	# Make sure we split out a subtree from master, rather than the branch we are currently on.
	git checkout master
	# Split out the `src` subdirectory and push it to the `pre-gh-pages` branch on remote `origin`.
	git subtree push --prefix src origin pre-gh-pages
	# Rebase the changes over the fixed commits on `gh-pages` (i.e. manually adding KaTeX).
	git worktree add ../quiver-worktree pre-gh-pages
	cd ../quiver-worktree
	git pull
	git checkout gh-pages
	git rebase pre-gh-pages
	git push --force
	cd ../quiver
	git worktree remove ../quiver-worktree
	# Checkout the branch we were originally working on.
	git checkout @{-1}
