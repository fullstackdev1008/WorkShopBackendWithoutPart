// Copy drizzle/*.sql into dist/ after tsc.
//
// Replaces `rm -rf dist/drizzle && cp -r drizzle dist/drizzle`, which only runs
// on a POSIX shell — on Windows npm hands the script to cmd.exe, where `rm` is
// "not recognized" and the build dies before the SQL is copied. Node's fs is
// the same everywhere, so this works in cmd, PowerShell, Git Bash and Linux CI.
import { rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'drizzle');
const dest = join(root, 'dist', 'drizzle');

if (!existsSync(src)) {
  console.error(`copy-drizzle: source folder not found: ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

const count = readdirSync(dest).filter((f) => f.endsWith('.sql')).length;
console.log(`copy-drizzle: copied ${count} .sql file(s) -> dist/drizzle`);
