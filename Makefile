.PHONY: all gh-pages

# Ensure `cd` works properly by forcing everything to be executed in a single shell.
.ONESHELL:

# Build KaTeX.
all:
	git submodule update --init --recursive
	cd src/KaTeX
	yarn
	yarn build

# Update the `dev` branch from `master`.
dev:
	git checkout dev
	git rebase master
	git checkout @{-1}

# Update the `release` branch from `dev`.
release:
	git checkout release
	git rebase dev
	git checkout @{-1}

# Update the quiver GitHub Pages application.
gh-pages:
	# We use several branches for the deployment workflow.
	# - `master`: Main development branch.
	# - `release`: The branch that is used for hosting on GitHub Pages.
	# - `dev`: The branch that is hosted under /dev on GitHub Pages.
	# - `gh-pages`: The branch that is actually hosted directly. This includes `release` and `dev`.

	# Checkout the release branch.
	git checkout release
	# Split off the `src/` directory into its own branch.
	RELEASE=$$(git subtree split --prefix=src)
	# Checkout the development branch.
	git checkout dev
	# Split off the `src/` directory into its own branch.
	DEV=$$(git subtree split --prefix=src)

	# Checkout the GitHub pages branch in a new worktree. We use a new worktree because the branch
	# is essentially incomparable with the other branches and we don't want to get any git conflicts
	# from switching incompatible branches.
	git worktree add ../quiver-worktree gh-pages
	cd ../quiver-worktree
	# Reset the GitHub Pages branch to contain the release source code.
	git reset --hard $$RELEASE

	# Build the dependencies in the release version. Note that this will always use the latest
	# version of KaTeX. Hopefully this will not come back and bite us later.
	git submodule update --init --recursive
	cd KaTeX
	yarn && yarn build
	# We need to be able to commit the dependencies, so we have to unregister KaTeX as a submodule.
	# Remove ignored files, apart from `dist/`, which is important as it contains things like fonts.
	git clean -dfX --exclude="!/dist/"
	find . -type f -name '.git' -delete
	cd ../
	git rm -r --cached KaTeX
	git rm .gitmodules
	git add KaTeX
	git add KaTeX/dist -f
	git commit -m "Build dependencies"

	# Merge the development branch into a `dev/`.
	git merge -s ours --no-commit $$DEV
	git read-tree --prefix=dev -u $$DEV
	# We have already built KaTeX, so don't need to do so again: we can just copy it across and make
	# sure it's not treated as a submodule.
	cd dev
	git rm -rf KaTeX
	git rm -f .gitmodules
	cd ../
	cp -r KaTeX dev

	git add dev/KaTeX
	git add dev/KaTeX/dist -f
	git commit -m "Add the dev branch"

	# Push to the remote `gh-pages` branch.
	git push --force
	# GitHub Pages will not rebuild in response to a force push, so we have to add a dummy commit to
	# force a rebuild.
	git commit -m 'Rebuild GitHub Pages' --allow-empty
	git push

	# Navigate back to the main working tree.
	cd ../quiver
	# Remove the temporary worktree.
	git worktree remove ../quiver-worktree -f
	# Checkout the original branch.
	git checkout @{-2}

