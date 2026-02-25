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

# Resolve version from Git tags or fallback VERSION file.
# Leading "v" is stripped.
#
# Output Formats:
# - Tagged version: "1.1.1" (from tag "v1.1.1")
# - Commits since tag: "v1.1.1-4-gabc123" (4 commits since tag, 'g' denotes Git hash)
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
    tag=$(git describe --tags --always --dirty --broken --match "v[0-9]*") &&
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

  # Strip leading 'v'
  tag="${tag#v}"

  printf "%s\n" "$tag"
`

package := "dist/" + project + "-" + version + ".zip"

# Format project files
format:
  mdformat --number *.md
  rg "[^\x00-\x7F]" && true

# Output key project file paths for LLM prompt context
context:
  #!/usr/bin/env bash
  printf "%s\n" \
    *.js \
    *.svg \
    justfile \
    manifest.json \
    README.md

# Prepare a full release
release: ensure-release-tag dist

# Ensure repo is clean and strictly pointed to by an annotated tag
ensure-release-tag:
  #!/usr/bin/env sh
  set -u # Error on undefined variables

  # Get the current repository status to check for uncommitted changes
  status=$(git status --porcelain) || {
    echo "Error: Failed to obtain git status." >&2
    exit 1
  }

  # Fail if there are any modified, added, or deleted files in the working directory
  if [ -n "$status" ]; then
    echo "Error: Working directory is not clean. Commit your changes before releasing." >&2
    exit 1
  fi

  # Identify the exact annotated tag pointing to the current commit.
  # This will fail if the tag is lightweight or if we are not exactly on the tag.
  tag=$(git describe --dirty --exact-match) || {
    echo "Error: Current commit is not pointed to by an exact, annotated tag." >&2
    echo "Formal releases require an annotated tag (e.g., git tag -a v1.0.0)." >&2
    exit 1
  }

  # Ensure the tag does not include a "dirty" suffix from uncommitted changes
  case "$tag" in
    *-dirty)
      echo "Error: Working directory is dirty. Cannot release." >&2
      exit 1
      ;;
  esac

  # Final verification: Does the strict annotated tag match our project version?
  # A mismatch here usually means the version variable is using a lightweight tag 
  # or a commit hash that 'ensure-release-tag' refuses to accept.
  if [ "$tag" != "{{version}}" ]; then
    echo "Error: Version mismatch. Release requires a formal annotated tag." >&2
    echo "Current tag '$tag' does not match calculated version '{{version}}'." >&2
    exit 1
  fi

# Create distribution artifacts
dist: clean-dist package archive-source
  #!/usr/bin/env sh
  set -u # Error on undefined variables

  # Enter the distribution directory or exit if it doesn't exist
  cd dist || {
    echo "Error: Could not change directory to dist" >&2
    exit 1
  }

  # Define a helper function to list files in a stable, null-terminated order
  each() {
    find . -maxdepth 1 -type f "$@" -printf '%f\0' | LC_ALL=C sort -z
  }

  # Compress all files not already compressed (.zst) and not zip files (.zip)
  each ! -name '*.zst' ! -name '*.zip' | xargs -0 --no-run-if-empty zstd --compress --ultra -20 --rm || {
    echo "Error: Zstd compression failed" >&2
    exit 1
  }

  # Calculate SHA256 checksums for all compressed artifacts
  each ! -name 'SHA256SUMS' | xargs -0 --no-run-if-empty sha256sum > SHA256SUMS || {
    echo "Error: Failed to generate SHA256 checksums" >&2
    exit 1
  }

  # Validate the newly created checksum file against the artifacts
  sha256sum -c SHA256SUMS || { echo "Error: Checksum verification failed" >&2; exit 1; }

  # Ensure a signing key is configured before attempting to sign
  if [ -z "{{signingkey}}" ]; then
    echo "WARNING: No signing key configuration found, the artifacts would not be signed" >&2
    exit
  fi

  # Define a function to create a detached GPG signature and verify it immediately
  sign() {
    gpg --default-key "{{signingkey}}" --armor --detach-sign --output "$1".asc "$1" &&
    gpg --verify "$1".asc "$1" || {
      echo "Error: GPG signing or verification failed for $1" >&2
      exit 1
    }
  }

  # Sign the checksums file to ensure the authenticity of the release
  sign SHA256SUMS

# Create a tarball of the source code
archive-source:
  #!/usr/bin/env sh
  set -u # Error on undefined variables

  # Ensure the distribution directory exists
  mkdir -p dist || {
    echo "Error: Could not create directory 'dist'" >&2
    exit 1
  }

  # Check if the project is a git repository to determine if it's "dirty"
  if [ -d .git ]; then
    # Capture uncommitted changes
    status=$(git status --porcelain) || {
      echo "Error: Failed to obtain git status." >&2
      exit 1
    }
  else
    # Force local file archiving if not in a git repository
    status=local
  fi

  # Define the target tarball path
  tarfile="dist/{{project}}-{{version}}.tar"

  # Choose archiving method based on repository state
  if [ -n "$status" ]; then
    echo "Creating archive from local files (uncommitted changes detected)..." >&2

    # Create archive manually excluding build artifacts and git metadata
    tar --exclude='./.git' --exclude='./.gitignore' --exclude='./dist' --exclude='./VERSION' --transform='s,^\.,{{project}}-{{version}},' --create --file="$tarfile" . || {
      echo "Error: Failed to create archive from local files." >&2
      exit 1
    }
  else
    echo "Creating archive from git HEAD (repository is clean)..." >&2

    # Create archive using git's internal archiving tool
    git archive --format=tar --prefix="{{project}}-{{version}}/" HEAD > "$tarfile" || {
      echo "Error: Failed to create archive from git HEAD." >&2
      exit 1
    }
  fi

  # Append a version metadata file to the existing tarball
  echo "{{version}}" > dist/VERSION && 
  tar --transform='s,^dist,{{project}}-{{version}},' -rf "$tarfile" dist/VERSION &&
  rm dist/VERSION || {
    echo "Error: Failed to append VERSION file to the archive." >&2
    exit 1
  }

# Package the extension into a ZIP file suitable for upload to the
# Firefox Add-ons (AMO) portal. It includes only the runtime files
# required by the browser.
@package:
  mkdir -p dist
  jq '.version = "{{version}}"' manifest.json > manifest.json.tmp
  mv manifest.json.tmp manifest.json
  rm -f "{{package}}"
  zip "{{package}}" \
    background.js \
    icon.svg \
    LICENSE \
    manifest.json
  jq '.version = "0.0.0"' manifest.json > manifest.json.tmp
  mv manifest.json.tmp manifest.json
  echo "Extension packaged successfully: {{package}}" >&2

# Remove all build artifacts
clean:
  rm -rf ./dist

# Remove dist artifacts
clean-dist:
  rm -rf ./dist
