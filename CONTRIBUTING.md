# Contributing to TokEMS

Thanks for helping improve TokEMS. Bug reports, documentation fixes, translations, tests, design feedback, and focused code changes are welcome.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before investing in a large feature or architectural change.
- Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Requirements: Node.js 24+, pnpm 11+, and Docker Desktop.

```bash
pnpm install
cp .env.example .env
pnpm docker:deploy
```

For source development:

```bash
pnpm dev
```

The repository uses a pnpm workspace and Turborepo. Keep changes within the relevant app or package, and update shared contracts before their consumers.

## Pull requests

1. Create a focused branch from the current `main`.
2. Add or update tests for behavior changes.
3. Run the relevant checks locally.
4. Update documentation when behavior, configuration, migrations, or public APIs change.
5. Open a pull request with the problem, approach, verification, and migration impact.

Run the full local gate before requesting review:

```bash
pnpm check
pnpm audit:security
```

Changes to persistent workflows may also require Docker acceptance tests listed in [README.md](README.md). Database changes must include an ordered Drizzle migration and an updated generated inventory.

## Style

- Use TypeScript for application and package code.
- Keep public contracts in `packages/contracts` and database definitions in `packages/database`.
- Preserve organization isolation and server-side authorization checks.
- Keep user-facing copy ready for extraction into `zh-CN` and `en-US` catalogs.
- Format changed files with Prettier and keep ESLint at zero warnings.

## Licensing

By contributing, you agree that your contribution is licensed under `AGPL-3.0-only`, the license used by this repository. Only submit work that you have the right to contribute.
