-- User profile fields — My Profile module + Add/Edit User photo & full name.
--   full_name  — optional display name
--   avatar_url — uploaded image PATH/key (resolved to a signed URL on read)
-- Additive + idempotent + backward compatible (existing rows stay NULL). Email
-- and username uniqueness stays enforced in the service layer (no DB unique
-- index) so existing duplicate data isn't rejected.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" varchar(150);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" varchar(500);
