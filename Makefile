.PHONY: all
.ONESHELL:
all:
	git submodule update --init --recursive
	cd src/KaTeX
	yarn
	yarn build
