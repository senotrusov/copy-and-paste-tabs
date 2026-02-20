# Copyright 2026 Stanislav Senotrusov
#
# This work is dual-licensed under the Apache License, Version 2.0 and the MIT License.
# See LICENSE in the top-level directory for details.
#
# SPDX-License-Identifier: Apache-2.0 OR MIT

# Output key project file paths for LLM prompt context
context:
  #!/usr/bin/env bash
  printf "%s\n" background.js icon.svg justfile manifest.json README.md
