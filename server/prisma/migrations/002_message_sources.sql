-- 002_message_sources.sql
--
-- Web sources consulted while generating an assistant reply.
--
-- On the message rather than in its own table: a source has no life outside the reply
-- that cited it, nothing queries across them, and the app reads them in the same
-- request that reads the message. A join table would be a second round trip for data
-- that is always wanted together.
--
-- Nullable with no default, so every existing row keeps meaning "this reply was
-- generated before search existed" rather than "this reply searched and found
-- nothing" -- which is what an empty array would say.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sources jsonb;

INSERT INTO migrations (name) VALUES ('002_message_sources.sql')
ON CONFLICT (name) DO NOTHING;
