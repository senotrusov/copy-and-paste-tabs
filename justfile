# Copyright 2026 Stanislav Senotrusov
#
# This work is dual-licensed under the Apache License, Version 2.0
# and the MIT License. Refer to the LICENSE file in the top-level directory
# for the full license terms.
#
# SPDX-License-Identifier: Apache-2.0 OR MIT

# Set the project name
project := "copy-and-paste-tabs"

# Retrieve the GPG signing key from the Git configuration if possible
signingkey := `git config --get user.signingkey || true`

# Resolve the version string from Git tags or a fallback VERSION file.
#
# Output Formats:
# - Exact tag: "v1.1.1"
# - Commits since tag: "v1.1.1-4-gabc123" ('g' denotes Git hash)
# - Uncommitted/untracked changes: Suffixes "-dirty"
# - Repository errors: Suffixes "-broken"
# - Fallback: "unknown"
#
# Note: We manually check 'git status' because 'git describe --dirty' may 
# ignore untracked files; this ensures the tag reflects the exact state.
version := `
  set -u # Error on undefined variables

  # Attempt to extract version from Git
  if [ -d .git ]; then
    tag=$(git describe --tags --always --dirty --broken) &&
    status=$(git status --porcelain) || {
      echo "Warning: Failed to obtain Git metadata." >&2
      echo "unknown"
      exit
    }

    # Manually append -dirty suffix if uncommitted changes exist
    if [ -n "$tag" ] && [ -n "$status" ]; then
      case "$tag" in
        *-dirty) ;; # Skip if already tagged as dirty
        *) tag="${tag}-dirty" ;; # Append suffix
      esac
    fi
  # Fallback to VERSION file if Git is unavailable
  elif [ -f VERSION ]; then
    read -r tag < VERSION
  fi

  # Final fallback if no version source succeeded
  if [ -z "${tag:-}" ]; then
    tag="unknown"
  fi

  printf "%s\n" "$tag"
`

# Output key project file paths for LLM prompt context
context:
  #!/usr/bin/env bash
  printf "%s\n" background.js icon.svg justfile manifest.json README.md

format:
  mdformat --number README.md CONTRIBUTING.md CONTRIBUTORS.md
  ! rg "[^\x00-\x7F]"
