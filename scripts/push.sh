#!/bin/bash
# Commit everything in this folder and push to GitHub -> Railway auto-deploys.
# Usage: ./scripts/push.sh "what changed"
# First run initializes the repo. Token: pat.md one level up (gitignored).
# Use a labeled line "AnetixVSM: <token>". Other labeled lines are ignored.
# A file holding a single bare token still works; several bare tokens do not.
set -e
cd "$(dirname "$0")/.."
MSG="${1:-update}"
REPO="brf1998-code/AnetixVSM"
LABEL="AnetixVSM"
PAT=../pat.md
CLEAN_URL="https://github.com/${REPO}.git"

TOKEN=$(grep -E "^${LABEL}:" "$PAT" 2>/dev/null | head -1 | sed "s/^${LABEL}://" | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then
  BARE=$(grep -vE '^[A-Za-z]+:' "$PAT" 2>/dev/null | grep -v '^[[:space:]]*$' || true)
  COUNT=$(printf '%s\n' "$BARE" | grep -c . || true)
  if [ "$COUNT" = "1" ]; then
    TOKEN=$(printf '%s' "$BARE" | tr -d '[:space:]')
  elif [ "$COUNT" -gt 1 ]; then
    echo "pat.md has ${COUNT} unlabeled tokens. Label the one for this repo: ${LABEL}: <token>"; exit 1
  fi
fi
[ -z "$TOKEN" ] && { echo "no token: add a line '${LABEL}: <token>' to ${PAT}"; exit 1; }

if [ ! -d .git ]; then git init -q -b main; fi
# Always take the token back out of .git/config, even if a step below fails.
trap 'git remote set-url origin "$CLEAN_URL" 2>/dev/null || true' EXIT
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
git fetch -q origin main 2>/dev/null && git merge -q --ff-only origin/main 2>/dev/null || true
git add -A
git status --short | grep -E "pat.md|node_modules/|\.env$" && { echo "refusing: secret or node_modules staged"; exit 1; }
git -c user.name="Brendan Finn" -c user.email="brf1998@gmail.com" commit -qm "$MSG" || echo "nothing to commit"
git push -u origin main
echo "pushed to ${REPO}. Railway (anetix-vsm-dev) is deploying."
