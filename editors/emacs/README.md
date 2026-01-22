# Quiver Mode for Emacs

A minor mode for editing TikZ-CD commutative diagrams with Quiver.

## Installation

### Using Elpaca + use-package

```elisp
(use-package quiver-mode
  :elpaca (:host github
           :repo "varkor/quiver"
           :files ("editors/emacs/*.el"))
  :hook ((LaTeX-mode . quiver-mode)
         (org-mode . quiver-mode))
  :custom
  ;; Optional: Set custom executable path if not in PATH
  (quiver-executable "~/path/to/quiver/src-tauri/target/release/quiver"))
```

### Using Local Path + use-package

```elisp
(use-package quiver-mode
  :load-path "~/path/to/quiver/editors/emacs/"
  :hook ((LaTeX-mode . quiver-mode)
         (org-mode . quiver-mode))
  :custom
  ;; Optional: Set custom executable path if not in PATH
  (quiver-executable "~/path/to/quiver/src-tauri/target/release/quiver"))
```

### Manual Installation

```elisp
;; Add the directory containing quiver-mode.el to load-path
(add-to-list 'load-path "~/path/to/quiver/editors/emacs/")

;; Load the package and enable the minor mode
(require 'quiver-mode)
(add-hook 'LaTeX-mode-hook #'quiver-mode)
(add-hook 'org-mode-hook #'quiver-mode)

;; Optional: Set custom executable path if not in PATH
(setq quiver-executable "~/path/to/quiver/src-tauri/target/release/quiver")
```

## Usage

When `quiver-mode` is enabled, you get:

- **Key bindings** for editing diagrams:
  - `C-c C-q e` - Edit diagram at point
  - `C-c C-q c` - Create new diagram
  - `C-c C-q k` - Kill current Quiver process

## Workflow

1. Place cursor inside a tikzcd environment and press `C-c C-q e`
2. Quiver opens with your diagram loaded
3. Edit visually and save with `Ctrl+S`
4. Diagram is automatically updated in Emacs

For new diagrams, press `C-c C-q c` to insert an empty tikzcd environment and start editing.

## Usage note

Diagram is loaded from the base64 encoding in the comment and parsing of diagram at point quite strict, so it is important not to modify it manually.

