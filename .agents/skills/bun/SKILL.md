---
name: Bun
description: Use when building, running, testing, or bundling JavaScript/TypeScript applications. Reach for Bun when you need to execute scripts, manage dependencies, run tests, or bundle code for production—it's a drop-in replacement for Node.js with integrated tooling.
metadata:
    mintlify-proj: bun
    version: "1.0"
---

# Bun Skill Reference

## Product Summary

Bun is an all-in-one JavaScript/TypeScript toolkit shipped as a single binary. It includes a fast runtime (4x faster startup than Node.js), package manager (25x faster installs), test runner (Jest-compatible), and bundler. The runtime uses JavaScriptCore (Apple's engine) and is written in Zig. Key files: `bunfig.toml` (configuration), `package.json` (scripts and dependencies), `bun.lock` (lockfile). Core commands: `bun run`, `bun install`, `bun test`, `bun build`. Primary docs: https://bun.com/docs

## When to Use

- **Running code**: Execute `.ts`, `.tsx`, `.js`, `.jsx` files directly without compilation steps
- **Package management**: Install, add, remove, or audit npm packages faster than npm/yarn/pnpm
- **Testing**: Write and run Jest-compatible tests with TypeScript support out of the box
- **Bundling**: Bundle JavaScript/TypeScript for browsers or servers with code splitting and plugins
- **Scripts**: Run `package.json` scripts 28x faster than npm
- **HTTP servers**: Build servers with `Bun.serve()` for high-performance APIs
- **Monorepos**: Manage workspaces with isolated or hoisted dependency strategies
- **Migrations**: Drop-in replacement for Node.js projects with minimal changes

## Quick Reference

### Essential Commands

| Task | Command |
|------|---------|
| Run a file | `bun run index.ts` or `bun index.ts` |
| Run a script | `bun run dev` (from package.json) |
| Install dependencies | `bun install` |
| Add a package | `bun add react` |
| Add dev dependency | `bun add -d typescript` |
| Run tests | `bun test` |
| Build/bundle | `bun build ./index.ts --outdir ./dist` |
| Watch mode | `bun --watch run index.ts` or `bun build --watch` |
| Global install | `bun install -g cowsay` |
| Execute package | `bunx package-name` |

### Configuration Files

| File | Purpose |
|------|---------|
| `bunfig.toml` | Bun-specific settings (optional, zero-config by default) |
| `package.json` | Scripts, dependencies, workspaces |
| `tsconfig.json` | TypeScript configuration (Bun respects this) |
| `bun.lock` | Lockfile (text-based, replaces package-lock.json) |

### Key bunfig.toml Sections

```toml
[install]
linker = "hoisted"  # or "isolated" for pnpm-like behavior
dev = true
optional = true
peer = true

[test]
root = "."
coverage = false
timeout = 5000

[run]
shell = "system"  # or "bun" on Windows
bun = true        # alias node to bun in scripts

[serve]
port = 3000
```

### File Type Support

| Extension | Behavior |
|-----------|----------|
| `.ts`, `.tsx` | Transpiled on-the-fly, TypeScript support |
| `.js`, `.jsx` | Transpiled on-the-fly, JSX support |
| `.json`, `.jsonc`, `.toml`, `.yaml` | Parsed and inlined at build time |
| `.html` | Imported as Response or bundled with assets |
| `.css` | Bundled into single CSS file |
| `.wasm`, `.node` | Supported at runtime, treated as assets in bundles |

## Decision Guidance

### When to Use Hoisted vs. Isolated Linker

| Scenario | Use |
|----------|-----|
| New monorepo/workspace | `isolated` (prevents phantom dependencies) |
| New single-package project | `hoisted` (traditional npm behavior) |
| Existing project (pre-v1.3.2) | `hoisted` (backward compatible) |
| Strict dependency isolation needed | `isolated` |
| Maximum compatibility with npm | `hoisted` |

### When to Use bun build vs. bun run

| Use Case | Tool |
|----------|------|
| Execute a script or file | `bun run` |
| Run package.json scripts | `bun run <script>` |
| Bundle for production | `bun build` |
| Create standalone executable | `bun build --compile` |
| Watch for changes during dev | `bun --watch run` or `bun build --watch` |

### When to Use bun test vs. External Test Framework

| Scenario | Use |
|----------|-----|
| Jest-compatible tests needed | `bun test` (built-in) |
| DOM/UI testing | `bun test` with HappyDOM or Testing Library |
| Snapshot testing | `bun test` (built-in) |
| Custom test framework | External framework (Vitest, etc.) |
| CI/CD with GitHub Actions | `bun test` (auto-detects, emits annotations) |

## Workflow

### 1. Initialize a Project
```bash
bun init my-app
# Choose template: Blank, React, or Library
cd my-app
```

### 2. Install Dependencies
```bash
bun install
# Or add specific packages
bun add react
bun add -d @types/react
```

### 3. Write and Run Code
```bash
# Create index.ts
bun run index.ts

# Or add to package.json scripts
# Then run: bun run dev
```

### 4. Configure (if needed)
Create `bunfig.toml` in project root for Bun-specific settings. Most projects work without it.

### 5. Test
```bash
# Create math.test.ts
bun test

# Watch mode
bun test --watch

# With coverage
bun test --coverage
```

### 6. Build for Production
```bash
bun build ./index.ts --outdir ./dist

# With minification
bun build ./index.ts --outdir ./dist --minify

# Create standalone executable
bun build ./cli.ts --outfile mycli --compile
```

### 7. Deploy
Commit `bun.lock` to version control. In CI, use `bun ci` (equivalent to `bun install --frozen-lockfile`) for reproducible builds.

## Common Gotchas

- **Flag placement**: Put Bun flags immediately after `bun`, not at the end: `bun --watch run dev` ✓, not `bun run dev --watch` ✗
- **Lifecycle scripts**: By default, Bun does NOT run `postinstall` scripts for security. Add packages to `trustedDependencies` in `package.json` to allow them.
- **Node.js compatibility**: Bun aims for Node.js compatibility but it's not 100% complete. Check the [compatibility page](/runtime/nodejs-compat) for your specific APIs.
- **Auto-install disabled in production**: When a security scanner is configured, auto-install is automatically disabled. Use `bun install` explicitly.
- **Lockfile format**: Bun v1.2+ uses text-based `bun.lock` by default (not binary `bun.lockb`). Old lockfiles can be migrated with `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`.
- **TypeScript errors on Bun global**: Install `@types/bun` and configure `tsconfig.json` with `"lib": ["ESNext"]` and `"moduleResolution": "bundler"`.
- **Peer dependencies**: Bun installs peer dependencies by default (unlike npm). Disable with `--omit peer` if needed.
- **External imports in bundles**: Mark packages as external with `--external` to prevent bundling them; they'll be imported at runtime instead.
- **Environment variables**: Use `process.env.VAR` in code; Bun loads `.env`, `.env.local`, and `.env.[NODE_ENV]` automatically.
- **Minification by default for bun target**: When bundling with `target: "bun"`, identifiers are minified automatically even without `--minify`.

## Verification Checklist

Before submitting work with Bun:

- [ ] Code runs without errors: `bun run index.ts` or `bun run <script>`
- [ ] Dependencies are installed: `bun install` completes successfully
- [ ] Tests pass: `bun test` shows all tests passing
- [ ] Lockfile is committed: `bun.lock` is in version control
- [ ] Configuration is valid: `bunfig.toml` (if present) has correct TOML syntax
- [ ] TypeScript compiles: No type errors in IDE or `bun check` (if available)
- [ ] Bundle builds: `bun build` completes without errors
- [ ] No security warnings: `bun install` shows no critical vulnerabilities
- [ ] Scripts work in CI: Test with `bun ci` to verify frozen lockfile behavior
- [ ] Trusted dependencies are declared: `trustedDependencies` in `package.json` for packages needing lifecycle scripts

## Resources

- **Comprehensive navigation**: https://bun.com/docs/llms.txt
- **Runtime API reference**: https://bun.com/docs/runtime
- **Package manager docs**: https://bun.com/docs/pm/cli/install
- **Bundler guide**: https://bun.com/docs/bundler
- **Test runner docs**: https://bun.com/docs/test

---

> For additional documentation and navigation, see: https://bun.com/docs/llms.txt