import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/models';

// Resolves the authenticated userId to a valid users.id, or null if the token is stale.
// Prevents FK violations on created_by / updated_by when the JWT references a deleted or cross-env user.
export async function resolveActorId(request: any): Promise<string | null> {
  const rawUserId = request?.user?.userId as string | undefined;
  if (!rawUserId) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, rawUserId)).limit(1);
  return u?.id ?? null;
}
