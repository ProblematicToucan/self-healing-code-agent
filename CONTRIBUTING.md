# Contributing

Thanks for helping improve **self-healing-code**. This project uses a **fork-based workflow** with **feature branches** and **pull requests**—please follow the steps below so reviews stay focused and history stays clear.

## Workflow (fork → branch → PR)

### 1. Fork the repository

On GitHub (or your Git host), **fork** this repo to your account. You will push branches to **your fork**, not directly to the upstream default branch.

```bash
# Add your fork as a remote (example name: fork)
git remote add fork https://github.com/YOUR_USERNAME/self-healing-code.git
```

Clone your fork if you have not already, or add `fork` as above and fetch.

### 2. Create a feature branch

**Always work on a dedicated branch**—never commit directly on `main` (or the default branch) when preparing a contribution.

```bash
git checkout main
git pull upstream main   # if you added upstream; otherwise pull from origin
git checkout -b feat/short-description-of-change
# or: fix/issue-123-description
```

Use a clear prefix when it helps, for example:

- `feat/` — new behavior or API
- `fix/` — bug fixes
- `docs/` — documentation only
- `chore/` — tooling, config, non-user-facing changes

### 3. Make your changes

- Match existing **TypeScript** style and patterns in the repo.
- Run **tests** before opening a PR:

  ```bash
  npm run test:run
  ```

- For substantive behavior changes, add or update tests when practical.

### 4. Push to your fork

```bash
git push -u fork feat/short-description-of-change
```

### 5. Open a pull request

Open a **Pull Request** from your fork’s feature branch into the **upstream** repository’s default branch (usually `main`).

In the PR description, include:

- **What** changed and **why**
- **How to verify** (commands run, manual checks)
- Links to **related issues**, if any

Maintainers may request changes; please update your branch (additional commits or a rebase, as requested) and push again—the PR will update automatically.

## Local development

See [README.md](README.md) for install, `npm run dev`, `npm run build`, and environment variables.

## Code of conduct

Be respectful and constructive in issues and pull requests. Assume good intent; focus feedback on the work, not the person.

## Questions

Open an issue for design questions or if you are unsure whether an idea fits the project—early discussion can save rework.
