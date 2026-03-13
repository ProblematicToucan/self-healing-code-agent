#!/bin/sh
set -e

# Install Cursor agent CLI at runtime (installs into /root/.local/bin, already on PATH)
curl https://cursor.com/install -fsS | bash

# Install GitHub CLI and Glab at runtime (like Cursor CLI)
mkdir -p /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg 2>/dev/null || true
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
curl -sSL "https://raw.githubusercontent.com/upciti/wakemeops/main/assets/install_repository" | bash
apt-get update -qq && apt-get install -y --no-install-recommends gh glab
rm -rf /var/lib/apt/lists/*

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
  
  export GITLAB_HOST="$GIT_HOST_RAW"
  export GH_HOST="$GIT_HOST_RAW"
  
  if command -v glab >/dev/null 2>&1; then
    glab config set --global host "$GIT_HOST_RAW" >/dev/null 2>&1 || true
    glab config set --global token "$GIT_TOKEN" --host "$GIT_HOST_RAW" >/dev/null 2>&1 || true
  fi
fi

exec "$@"
