import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  // GRAPH-WIRE-1: the LangGraph Postgres checkpointer (`saver.setup()`)
  // self-creates `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, and
  // `checkpoint_migrations`. These are NOT in the Drizzle schema. `db:deploy`
  // uses `drizzle-kit migrate`, which applies SQL files and never drops unknown
  // tables — so they're already safe at deploy. This filter additionally keeps
  // any future `generate`/`push` (diff-based) from trying to drop them. No
  // project table starts with `checkpoint`, so this is non-destructive.
  tablesFilter: ['*', '!checkpoint*'],
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://postgres:postgres@localhost:5432/workspace_platform',
  },
  verbose: true,
  strict: true,
})
