#!/usr/bin/env bash
# The Phase 3 safety gate. Four boundaries the PRD states, as commands rather than habits.
#
# Run AFTER `pnpm build`: three of the five need build output to mean anything.
#
# Scope note, learned the hard way: every grep targets .next/server and .next/static, which is
# what Vercel deploys. Never bare .next/, which also holds:
#   .next/cache  TypeScript's incremental cache, listing source paths it never ships. Reports the
#                gmail devDependency as a leak when nothing leaked.
#   .next/dev    the running dev server's Turbopack cache, which DOES write env values to disk.
#                Gitignored and never deployed, but it made this gate fail intermittently, since
#                the dev server rewrites it while the gate runs.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

say() { printf '  %-42s %s\n' "$1" "$2"; }
absent() { # absent <label> <path...> <pattern>
  local label="$1" pattern="$2"; shift 2
  local out; out=$(grep -rl "$pattern" "$@" 2>/dev/null)
  if [ -n "$out" ]; then say "$label" "*** FOUND ***"; echo "$out" | head -3 | sed 's/^/      /'; fail=1
  else say "$label" "clean"; fi
}

echo "SAFETY GATE"

if pnpm check-corpus >/dev/null 2>&1; then say "1. corpus carries no real content" "clean"
else say "1. corpus carries no real content" "*** FAILED ***"; fail=1; fi

if [ "$(git ls-files | grep -c 'labelled-50')" = "0" ]; then say "1b. real threads untracked" "clean"
else say "1b. real threads untracked" "*** TRACKED ***"; fail=1; fi

if [ -d .next/static ]; then
  # The env var NAME is expected in server code; that is how the SDK reads it. What must never
  # appear anywhere is the VALUE, so test for the real secret rather than the string that names it.
  absent "2. no secret NAME in client bundle" "TYPESAFE_API_KEY\|TURSO_AUTH_TOKEN" .next/static
  leaked=0
  if [ -f .env.local ]; then
    while IFS='=' read -r name value; do
      case "$name" in TYPESAFE_API_KEY|TURSO_AUTH_TOKEN|BLOB_READ_WRITE_TOKEN) ;; *) continue ;; esac
      [ -n "${value:-}" ] || continue
      if grep -rqF "$value" .next/server .next/static 2>/dev/null; then
        say "2b. secret VALUE for $name" "*** INLINED IN BUILD ***"; leaked=1; fail=1
      fi
    done < .env.local
  fi
  [ $leaked -eq 0 ] && say "2b. no secret VALUE anywhere in build" "clean"
  absent "3. no mailbox surface in shipped build" "googleapis\|gmail\.readonly" .next/static .next/server
  absent "5. no SDK in client chunks" "typesafe-ai/sdk\|systemOne" .next/static/chunks
else
  say "2,3,5 build checks" "SKIPPED - run pnpm build first"; fail=1
fi

if node -e "const p=require('./package.json');if(Object.keys(p.dependencies).some(d=>/google/.test(d)))process.exit(1)"; then
  say "3b. gmail is a devDependency only" "clean"
else say "3b. gmail is a devDependency only" "*** RUNTIME DEP ***"; fail=1; fi

if pnpm ls --depth 10 2>/dev/null | grep -qiE 'openai|anthropic|@google/gen|langchain|mistral|cohere'; then
  say "4. no generative model in the tree" "*** FOUND ***"; fail=1
else say "4. no generative model in the tree" "clean"; fi

echo
[ $fail -eq 0 ] && { echo "ALL CLEAN"; exit 0; } || { echo "GATE FAILED"; exit 1; }
