#!/usr/bin/env bash
# Single source of truth for which Playwright specs (apps/e2e/tests) run in which CI suite.
#  - ST01 (infra/scripts/st01-playwright-ci.sh): needs only the BUILT Storefront and the API.
#  - Full stack (infra/scripts/e2e-fullstack-ci.sh): every other spec. They log in with dev tokens,
#    which only exist when NODE_ENV !== "production", so Storefront, Portal and Admin run under
#    `next dev`, next to the API, the worker and a local SePay mock.
# A new spec therefore runs in the full-stack suite unless it is added to ST01_SPECS on purpose.
# Paths are relative to apps/e2e. Source this file; it defines variables and functions only.

ST01_SPECS=(tests/st01-home.spec.ts tests/st13-policy-pages.spec.ts)

# Fails when an ST01 entry does not name exactly one existing spec file: Playwright silently ignores
# a filter that matches nothing as long as another filter matches something.
e2e_check_st01_specs() {
  local root="$1" spec
  for spec in "${ST01_SPECS[@]}"; do
    if [[ ! -f "$root/apps/e2e/$spec" ]]; then
      echo "ST01_SPECS names a missing spec: $spec" >&2
      return 1
    fi
  done
}

# Prints every spec that is not in ST01_SPECS, one per line, relative to apps/e2e.
e2e_fullstack_specs() {
  local root="$1" file rel st01
  for file in "$root"/apps/e2e/tests/*.spec.ts; do
    rel="tests/${file##*/}"
    for st01 in "${ST01_SPECS[@]}"; do [[ "$rel" == "$st01" ]] && continue 2; done
    echo "$rel"
  done
}
