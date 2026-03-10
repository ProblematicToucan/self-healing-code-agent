#!/bin/sh
set -e
# If GIT_TOKEN is set, configure Git to use it for HTTPS (clone/push) so no prompts inside container.
if [ -n "$GIT_TOKEN" ] && [ -x /app/git-credential-helper.sh ]; then
  git config --global credential.helper '/app/git-credential-helper.sh'
fi
exec "$@"
