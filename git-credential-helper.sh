#!/bin/sh
# Git credential helper: when GIT_TOKEN is set, supplies it for HTTPS (e.g. GitHub).
# Used so clone/push from inside the container never prompt for username/password.
# Protocol: https://git-scm.com/docs/gitcredential
case "$1" in
  get)
    if [ -n "$GIT_TOKEN" ]; then
      echo "username=oauth2"
      echo "password=$GIT_TOKEN"
    fi
    ;;
  store|erase) ;;
  *) ;;
esac
