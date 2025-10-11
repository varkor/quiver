;;; quiver-mode.el --- Edit commutative diagrams in Quiver -*- lexical-binding: t -*-

;; Copyright (C) 2025

;; Author: remimimimimi
;; Version: 1.0.0
;; Package-Requires: ((emacs "26.1"))
;; Keywords: tex, tikz, diagrams
;; URL: https://github.com/varkor/quiver

;;; Commentary:

;; This package provides integration between Emacs and Quiver, a modern
;; commutative diagram editor.  It allows you to edit TikZ-CD diagrams
;; in Quiver's visual editor directly from Emacs.

;;; Code:

(require 'subr-x)  ; For string-trim

(defgroup quiver nil
  "Quiver commutative diagram editor integration."
  :group 'tex
  :prefix "quiver-")

(defcustom quiver-executable "quiver"
  "Path to the Quiver executable."
  :type 'string
  :group 'quiver)

(defcustom quiver-confirm-kill-process t
  "Whether to confirm before killing Quiver process."
  :type 'boolean
  :group 'quiver)

(defcustom quiver-tikzcd-begin-regex "\\\\\\[\\\\begin{tikzcd}"
  "Regular expression to match the beginning of a tikzcd diagram."
  :type 'regexp
  :group 'quiver)

(defcustom quiver-tikzcd-end-regex "\\\\end{tikzcd}\\\\\\]"
  "Regular expression to match the end of a tikzcd diagram."
  :type 'regexp
  :group 'quiver)

(defcustom quiver-comment-regex "^% https://q\\.uiver\\.app/#q=\\([A-Za-z0-9+/]+\\)=*"
  "Regular expression to match Quiver URL comments.
The first capturing group should contain the base64 data."
  :type 'regexp
  :group 'quiver)

(defcustom quiver-comment-after-regex "\\s-*\\\\\\[\\\\begin{tikzcd}"
  "Regular expression to match spacing and diagram start after comment."
  :type 'regexp
  :group 'quiver)

(defcustom quiver-url-pattern-to-replace "% tauri://localhost#q="
  "URL pattern to replace in Quiver output.
This is typically the local Tauri URL that needs to be replaced."
  :type 'string
  :group 'quiver)

(defcustom quiver-url-replacement "% https://q.uiver.app/#q="
  "Replacement URL pattern for Quiver output.
This is the public Quiver URL that should replace the local URL."
  :type 'string
  :group 'quiver)

(defun quiver--validate-executable ()
  "Validate that the Quiver executable exists and is executable."
  (unless (executable-find quiver-executable)
    (user-error "Quiver executable '%s' not found. Please install Quiver or set `quiver-executable'" quiver-executable)))

(defun quiver--validate-startup ()
  "Validate preconditions for starting Quiver."
  (quiver--validate-executable)
  (when (and quiver--current-process
             (process-live-p quiver--current-process))
    (user-error "Quiver is already running. Please close it first or use M-x quiver-kill-process")))

(defun quiver--start-process-with-cleanup (process-name temp-file sentinel-func &optional base64-data)
  "Start Quiver process with proper error handling and cleanup.
PROCESS-NAME is the name for the process.
TEMP-FILE is the output file path.
SENTINEL-FUNC is the process sentinel function.
BASE64-DATA is optional diagram data to load."
  (let ((original-read-only buffer-read-only))
    (setq buffer-read-only t)
    (force-mode-line-update)
    (condition-case err
        (let ((process (if base64-data
                          (start-process process-name nil quiver-executable
                                       "--output-file" temp-file base64-data)
                        (start-process process-name nil quiver-executable
                                     "--output-file" temp-file))))
          (setq quiver--current-process process)
          (set-process-sentinel process sentinel-func)
          process)
      (error
       ;; Restore read-only state and clean up on error
       (setq buffer-read-only original-read-only)
       (force-mode-line-update)
       (when (file-exists-p temp-file)
         (delete-file temp-file))
       (signal (car err) (cdr err))))))

(defun quiver--fix-domain-in-content (content)
  "Replace tauri://localhost with proper quiver domain in CONTENT."
  (replace-regexp-in-string
   quiver-url-pattern-to-replace
   quiver-url-replacement
   content))

(defun quiver--handle-process-completion (process temp-file buffer original-read-only success-callback)
  "Handle common process completion logic.
PROCESS is the completed process.
TEMP-FILE is the output file to process.
BUFFER is the target buffer.
ORIGINAL-READ-ONLY is the original read-only state.
SUCCESS-CALLBACK is called with (content buffer original-read-only) on success."
  (when (memq (process-status process) '(exit signal))
    (if (and (eq (process-status process) 'exit)
             (= (process-exit-status process) 0)
             (file-exists-p temp-file))
        ;; Process succeeded and output file exists
        (progn
          (if (buffer-live-p buffer)
              (let ((content (with-temp-buffer
                              (insert-file-contents temp-file)
                              (buffer-string))))
                ;; Check if content is meaningful (should start with % comment)
                (if (not (string-prefix-p "%" content))
                    (progn
                      (message "Quiver produced empty output - existing diagram preserved")
                      ;; Restore read-only state without replacing content
                      (with-current-buffer buffer
                        (setq buffer-read-only original-read-only)
                        (force-mode-line-update)))
                  ;; Fix domain and call success callback
                  (funcall success-callback
                           (quiver--fix-domain-in-content content)
                           buffer
                           original-read-only)))
            (message "Buffer was killed while Quiver was running"))
          ;; Clean up temp file
          (delete-file temp-file))
      ;; Process failed or was killed
      (progn
        (message "Quiver process %s" (string-trim (format "%s" process)))
        ;; Clean up temp file if it exists
        (when (file-exists-p temp-file)
          (delete-file temp-file))
        ;; Restore read-only state on failure
        (when (buffer-live-p buffer)
          (with-current-buffer buffer
            (setq buffer-read-only original-read-only)
            (force-mode-line-update)))))
    ;; Clear the current process
    (setq quiver--current-process nil)))

(defcustom quiver-temp-file-prefix "quiver-create-"
  "Prefix for temporary files created by Quiver."
  :type 'string
  :group 'quiver)

;; Process tracking
(defvar quiver--current-process nil
  "Currently running Quiver process, if any.")

;; Mode map
(defvar quiver-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "C-c C-q e") #'quiver-edit)
    (define-key map (kbd "C-c C-q c") #'quiver-create)
    (define-key map (kbd "C-c C-q k") #'quiver-kill-process)
    map)
  "Keymap for `quiver-mode'.")

;;;###autoload
(defun quiver-edit ()
  "Edit the TikZ-CD diagram at point using Quiver."
  (interactive)
  ;; Validate startup preconditions
  (quiver--validate-startup)
  (let ((diagram-info (quiver--find-diagram-at-point)))
    (if diagram-info
        (let* ((base64-data (plist-get diagram-info :base64))
               (start (plist-get diagram-info :start))
               (end (plist-get diagram-info :end))
               (temp-file (make-temp-file quiver-temp-file-prefix nil ".tex")))
          ;; Capture original read-only state before starting process
          (let ((original-read-only buffer-read-only))
            (quiver--start-process-with-cleanup
             "quiver-edit"
             temp-file
             (lambda (proc event)
               (quiver--handle-process-completion
                proc temp-file (current-buffer) original-read-only
                (lambda (content buffer original-read-only)
                  (with-current-buffer buffer
                    (let ((inhibit-read-only t)
                          (saved-point (point)))
                      ;; Replace content while preserving cursor position
                      (save-excursion
                        (delete-region start end)
                        (goto-char start)
                        (insert content))
                      ;; Restore point if it was within the replaced region
                      (when (and (>= saved-point start) (<= saved-point end))
                        ;; Put cursor at same relative position in new content
                        (goto-char (min saved-point (+ start (length content)))))
                      (setq buffer-read-only original-read-only)
                      (force-mode-line-update)
                      (message "Diagram updated successfully"))))))
             base64-data))
          (message "Quiver started. Edit diagram and press Ctrl+S to save."))
      (message "No tikzcd diagram found at point"))))

(defun quiver--find-diagram-at-point ()
  "Find tikzcd diagram at point and return info about it.
Returns a plist with :base64, :start, and :end, or nil if not found."
  (let ((original-point (point)))
    (save-excursion
      ;; Look for the tikzcd pattern around point
      (when (re-search-backward quiver-tikzcd-begin-regex nil t)
        (let ((diagram-start (match-beginning 0)))
          ;; Search forward from the beginning of this match
          (goto-char diagram-start)
          (when (re-search-forward quiver-tikzcd-end-regex nil t)
            (let ((diagram-end (match-end 0)))
              (when (and (>= original-point diagram-start)
                         (<= original-point diagram-end))
                ;; Point is within diagram bounds, now look for comment
                (goto-char diagram-start)
                (when (re-search-backward quiver-comment-regex nil t)
                  (let ((comment-start (match-beginning 0))
                        (base64-data (match-string 1)))
                    ;; Make sure comment is right before the diagram
                    (goto-char (match-end 0))
                    (when (looking-at quiver-comment-after-regex)
                      ;; Validate base64 data is reasonable
                      (when (and base64-data (> (length base64-data) 0))
                        (list :base64 base64-data
                              :start comment-start
                              :end diagram-end)))))))))))))


;;;###autoload
(defun quiver-create ()
  "Create a new TikZ-CD diagram using Quiver."
  (interactive)
  ;; Validate startup preconditions
  (quiver--validate-startup)
  (let* ((temp-file (make-temp-file quiver-temp-file-prefix nil ".tex"))
         (insertion-point (point-marker))
         (original-read-only buffer-read-only))
    ;; Start process with helper function
    (quiver--start-process-with-cleanup
     "quiver-create"
     temp-file
     (lambda (proc event)
       (quiver--handle-process-completion
        proc temp-file (current-buffer) original-read-only
        (lambda (content buffer original-read-only)
          (with-current-buffer buffer
            (goto-char insertion-point)
            (let ((inhibit-read-only t))
              (insert content))
            (setq buffer-read-only original-read-only)
            (force-mode-line-update)
            (message "Diagram inserted successfully"))))
       ;; Clean up marker after process completes
       (set-marker insertion-point nil)))
    (message "Quiver started. Create diagram and press Ctrl+S to insert.")))


;;;###autoload
(defun quiver-kill-process ()
  "Kill the currently running Quiver process."
  (interactive)
  (if (and quiver--current-process
           (process-live-p quiver--current-process))
      (when (or (not quiver-confirm-kill-process)
                (yes-or-no-p "Kill running Quiver process? "))
        (kill-process quiver--current-process)
        ;; Don't clear quiver--current-process here - let sentinel handle it
        ;; This avoids race conditions with the process sentinel
        (message "Quiver process killed"))
    (message "No Quiver process is currently running")))

;;;###autoload
(define-minor-mode quiver-mode
  "Minor mode for editing TikZ-CD diagrams with Quiver.

When enabled, provides key bindings for editing commutative diagrams
using the Quiver editor.

Key bindings:
\\{quiver-mode-map}"
  :lighter " Quiver"
  :keymap quiver-mode-map
  :group 'quiver)

(provide 'quiver-mode)

;;; quiver-mode.el ends here
