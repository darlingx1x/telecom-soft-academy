# Vercel and Neon

The application uses PostgreSQL when `DATABASE_URL` is present and keeps SQLite for local development without that variable. Neon pooled `DATABASE_URL` is used for application traffic; `DATABASE_URL_UNPOOLED` is reserved for migrations and direct administrative work.

## Local Neon development

Install the Neon CLI and authenticate, then run `neon init` for the project. `neon deploy` provisions configured Neon services and writes connection variables to the ignored `.env.local`. Start with `npm start`; the command loads `.env.local`. Never commit that file.

The PostgreSQL schema is in `migrations/001_postgres.sql`. For a fresh Neon branch, `npm start` applies the schema and seeds demonstration data only when the users table is empty. The project uses `pg` and the pooled connection string for application requests.

## Importing the existing SQLite data

`npm run db:import` copies rows from `data/academy.sqlite` into Neon. It creates the schema first, preserves rows already present in Neon on key conflicts, and intentionally skips sessions so old login tokens are not transferred. Set `SQLITE_SOURCE` to choose another SQLite file. Review the source and target branches before running an import; the default `.env.local` target is the branch checked out by Neon CLI.

## Vercel

The API entry point is `api/index.mjs`; `vercel.json` routes API requests to it. Add the pooled `DATABASE_URL` from the intended Neon branch to Vercel's environment variables for each deployment environment. Do not add `.env.local` to Git. The current Vercel deployment has not been created or published as part of this database setup.
