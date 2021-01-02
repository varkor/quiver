.PHONY: all gh-pages

# Ensure `cd` works properly by forcing everything to be executed in a single shell.
.ONESHELL:

# Build KaTeX.
all:
	set -e
	curl -L -O "https://github.com/KaTeX/KaTeX/releases/download/v0.12.0/katex.zip"
	unzip katex.zip
	rm katex.zip
	mv katex src/KaTeX

# Update the `dev` branch from `master`.
dev:
	set -e
	git checkout dev
	git rebase master
	git checkout @{-1}

# Update the `release` branch from `dev`.
release:
	set -e
	git checkout release
	git rebase dev
	git checkout @{-1}

# Update the quiver GitHub Pages application.
gh-pages:
	# We use several branches for the deployment workflow.
	# - `master`: Main development branch.
	# - `release`: The branch that is used for hosting on GitHub Pages.
	# - `dev`: The branch that is hosted under /dev on GitHub Pages.
	# - `squash`: A temporary branch containing squashed versions of `release` and `dev`.
	# - `gh-pages`: The branch that is actually hosted directly. This includes `release` and `dev`.

	# Terminate if there are any errors. We may have to do some manual cleanup in this case, but
	# it's better than trying to push a broken version of quiver.
	set -e
	# It's too error-prone to clone KaTeX from the origin each time we want to push quiver, so we
	# instead copy it from an existing directory, typically the one in `src/KaTeX`, which must be
	# stored in the `$KATEX` environment variable.
	if [ ! -d "$$KATEX" ]; then
		exit "KATEX must be set to a directory."
	fi
	# Store the name of the current branch, to return to it after completing this process.
	CURRENT=$$(git rev-parse --abbrev-ref HEAD)
	# Checkout the release branch.
	git checkout release
	# Get the initial commit ID, which will be used for squashing history.
	TAIL=$$(git rev-list --max-parents=0 HEAD)
	# Copy the release branch on to a new branch, for squashing purposes.
	git checkout -b squashed
	# Squash all the history (excluding the fixed, initial commit). This will improve performance
	# for `subtree split` later, which has to iterate through the entire history of the branch.
	git reset $$TAIL
	git add -A
	git commit -m "Add release branch"
	# Split off the `src/` directory into its own branch.
	RELEASE=$$(git subtree split --prefix=src)
	# Checkout the development branch, squash it, and split it off, just like `release`.
	git checkout dev
	git branch -D squashed
	git checkout -b squashed
	git reset $$TAIL
	git add -A
	git commit -m "Add dev branch"
	DEV=$$(git subtree split --prefix=src)

	# Checkout the GitHub Pages branch in a new worktree. We use a new worktree because the branch
	# is essentially incomparable with the other branches and we don't want to get any git conflicts
	# from switching incompatible branches.
	git worktree add ../quiver-worktree gh-pages
	cd ../quiver-worktree
	# Reset the GitHub Pages branch so that it contains the release source code.
	git reset --hard $$RELEASE

	# Merge the development branch into the `dev/` directory.
	git merge -s ours --no-commit $$DEV
	git read-tree --prefix=dev -u $$DEV
	# We have already cloned KaTeX and stripped it of git repository information, so don't need to
	# do so again: we can just copy it across.
	cp -r KaTeX dev
	git add -A
	git commit -m "Merge dev as subdirectory of release"

	# Push to the remote `gh-pages` branch. We do need to force push at some point, to overwrite the
	# existing branch content. However, this will not suffice to rebuild on GitHub Pages, so we then
	# perform another (non-`--force`) push immediately afterwards.
	git push --force
	# Set the `CNAME`. It is convenient to do so now, because we have to push a commit anyway to
	# force a rebuild, and we need to set the `CNAME` eventually.
	printf "q.uiver.app" > CNAME
	git add CNAME
	git commit -m "Create CNAME"
	git push

	# Navigate back to the main working tree.
	cd ../quiver
	# Remove the temporary worktree.
	git worktree remove ../quiver-worktree -f
	# Checkout the original branch.
	git checkout $$CURRENT
	# Delete the temporary `squashed` branch.
	git branch -D squashed
