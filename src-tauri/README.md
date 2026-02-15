# quiver Tauri Application

A desktop wrapper for [quiver](https://q.uiver.app), the modern commutative diagram editor, built with Tauri. This application was designed for editor integration and local file handling capabilities.

## Overview

This Tauri application wraps the quiver web application to provide:
- Native desktop experience with local file system access
- Command-line interface for editor integration
- Direct export to LaTeX files
- Local macro file loading
- Cross-platform compatibility (Windows, macOS, Linux)

## Prerequisites

Before building this application, ensure you have installed all prerequisites for your operating system as listed in the [Tauri v2 documentation](https://v2.tauri.app/start/prerequisites/).

## Installation

### Building from source

1. Clone the repository and navigate to the Tauri directory:
   ```sh
   git clone https://github.com/varkor/quiver.git
   cd quiver/src-tauri
   ```

2. Build the application:
   ```sh
   cargo build --release
   ```

### Installing globally

For convenient command-line usage, install the application globally:

```sh
cargo install --path .
```

This installs the `quiver` binary to `~/.cargo/bin`. Ensure this directory is in your PATH to run quiver from anywhere in your terminal.

## Usage

### Basic usage

Launch quiver with:
```sh
quiver
```
It will allow you to use quiver almost like the version on the website, except that you won't see url line.

### Examples

1. Open quiver with a specific diagram:
   ```sh
   quiver "WzAsMixbMCwwLCJBIl0sWzEsMCwiQiJdLFswLDEsImYiXV0"
   ```

2. Save diagram to a file on exit:
   ```sh
   quiver --output-file diagram.tex
   ```

3. Load custom macros from a local file:
   ```sh
   quiver --macros ~/.config/quiver/macros.tex
   ```

4. Load macros from a URL:
   ```sh
   quiver --macros https://example.com/my-macros.tex
   ```

## Editor Integration

The Tauri application is designed to integrate seamlessly with text editors. See [emacs package](../editors/emacs/README.md) for more.
