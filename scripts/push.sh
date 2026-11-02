#!/bin/bash
# Commit everything in this folder and push to GitHub -> Railway auto-deploys.
# Usage: ./scripts/push.sh "what changed"
# First run initializes the repo. Token: pat.md one level up (gitignored),
# either a bare token or "SymbioticOS: <token>".
set -e
cd "$(dirname "$0")/.."
MSG="${1:-update}"
TOKEN=$(tr -d '[:space:]' < ../pat.md | sed 's/^SymbioticOS://')
REPO="brf1998-code/AnetixVSM"
if [ ! -d .git ]; then git init -q -b main; fi
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
git fetch -q origin main 2>/dev/null && git merge -q --ff-only origin/main 2>/dev/null || true
git add -A
git status --short | grep -E "pat.md|node_modules/|\.env$" && { echo "refusing: secret or node_modules staged"; exit 1; }
git -c user.name="Brendan Finn" -c user.email="brf1998@gmail.com" commit -qm "$MSG" || echo "nothing to commit"
git push -u origin main
git remote set-url origin "https://github.com/${REPO}.git"
echo "pushed to ${REPO}. Railway (anetix-vsm-dev) is deploying."
