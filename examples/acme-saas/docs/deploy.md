# Deploy

Production runs on Fly.io, two regions (`iad`, `fra`). Auto-deploy on
push to `main` once CI is green.

## Manual deploy

```sh
bun install
bun run build
fly deploy --remote-only
```

## Rollback

```sh
fly releases             # find the previous good version
fly releases revert <n>  # one-shot
```

Rollbacks are usually <60 s. If a rollback is failing the DB is almost
certainly the cause — check the recent migration and bring it back with
`bun run db:down`.

## Env vars

See `.env.example`. Production secrets are in Fly secrets, not in the repo.
The single rule: **if a key starts with `sk_` or `whsec_` or looks like a
password, it doesn't get a default in `.env.example`** — use an empty string
or a sentinel like `replace-with-…`.
