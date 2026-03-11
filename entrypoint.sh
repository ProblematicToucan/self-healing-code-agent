#!/bin/sh
set -e
# If GIT_TOKEN is set, configure Git to use it for HTTPS (clone/push) so no prompts inside container.
if [ -n "$GIT_TOKEN" ] && [ -x /app/git-credential-helper.sh ]; then
  git config --global credential.helper '/app/git-credential-helper.sh'
  
  # Configure authentication for gh and glab CLI using the GIT_TOKEN
  export GH_TOKEN="$GIT_TOKEN"
  export GITLAB_TOKEN="$GIT_TOKEN"
fi
# Configure GitLab self-hosted host if GIT_URL is provided
if [ -n "$GIT_URL" ]; then
  # Strip http://, https://, and trailing slash to get just the hostname/port
  GIT_HOST_RAW=$(echo "$GIT_URL" | sed -e 's|^[^/]*//||' -e 's|/$||')
  
  export GITLAB_HOST="$GIT_URL"
  export GH_HOST="$GIT_URL"
  
  if command -v glab >/dev/null 2>&1; then
    glab config set --global host "$GIT_HOST_RAW" >/dev/null 2>&1 || true
    glab config set --global token "$GIT_TOKEN" --host "$GIT_HOST_RAW" >/dev/null 2>&1 || true
  fi
fi

exec "$@"
