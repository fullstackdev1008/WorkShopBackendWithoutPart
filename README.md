# WorkShopBackendWithoutPart

API for the TrueGear vehicle workshop management system. Handles the full workshop flow:

```
Customer → Vehicle → Check-In → QC Inspection → Job Card → Parts → Billing
```

## Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Fastify
- **DB:** PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Auth:** JWT (`jsonwebtoken`) + bcrypt
- **Storage:** Supabase S3-compatible bucket (`@aws-sdk/client-s3`) with `sharp` for image processing
- **Email:** Nodemailer (SMTP)

## Getting started

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, SMTP, AWS, etc.
npm run dev            # nodemon on src/server.ts
```

Default port: `3000` (configurable via `PORT`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start dev server with nodemon |
| `npm run build` | Compile TS → `dist/` |
| `npm start` | Run compiled server |
| `npm run db:generate` | Generate a new migration from schema changes |
| `npm run db:migrate` | Apply migrations (requires `drizzle/meta/_journal.json`) |
| `npm run db:push` | Sync schema directly to DB (interactive) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:seed` | Run `src/scripts/seed.ts` |
| `npm run db:truncate` | Run `src/scripts/truncate.ts` |

## Environment variables

See `.env` for the full list. Key ones:

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT`, `HOST` | Server bind |
| `UPLOAD_DIR`, `MAX_FILE_SIZE`, `USE_LOCAL_STORAGE` | File upload settings |
| `AWS_S3_ENDPOINT`, `AWS_S3_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Supabase S3 bucket |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email for estimate sharing |

## Project layout

```
src/
├── server.ts            # Fastify bootstrap
├── app.ts               # App config + plugin wiring
├── config/              # Env + runtime config
├── db/
│   ├── models/          # Drizzle schema (table definitions)
│   └── ...
├── middleware/          # Auth, error handling, etc.
├── modules/             # Feature modules (routes + services per domain)
│   ├── auth/
│   ├── customers/
│   ├── vehicles/
│   ├── vehicle-checkin/
│   ├── qc-inspections/
│   ├── workshop/        # Job cards
│   ├── parts/, parts-manager/
│   ├── appointments/
│   ├── invoicing/
│   ├── vehicle-360/     # Vehicle history aggregation
│   └── ...
├── plugins/             # Fastify plugins (CORS, multipart, static)
├── services/            # Cross-module services (storage, email, etc.)
├── scripts/             # CLI scripts (seed, truncate, dumps)
└── shared/              # Shared types/utils
```

Each module under `modules/` typically owns its own routes, controllers, services, and schemas — keeping domain logic colocated.

## Database

The schema is defined in [src/db/models/](src/db/models/) and lives in PostgreSQL. For a full breakdown of tables, relationships, status flows, and the ER diagram, see [DB_SCHEMA_NOTES.md](DB_SCHEMA_NOTES.md).

Migration SQL lives in [drizzle/](drizzle/).

### Bootstrapping a fresh database

1. Create the database:
   ```bash
   createdb workshop_new
   ```
2. Point `DATABASE_URL` at it.
3. Apply schema — either:
   - `npm run db:push` (fastest, syncs current schema), or
   - Apply each file in `drizzle/*.sql` via `psql` in order.
4. Optional: `npm run db:seed` for reference data.

## API

A Postman collection is checked in at [postman_collection.json](postman_collection.json). Import it to explore endpoints.

## Frontend

The companion frontend lives in [../TrueGearWithoutPart/](../TrueGearWithoutPart/).
