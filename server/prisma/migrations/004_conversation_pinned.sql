-- 004_conversation_pinned.sql
--
-- Whether a conversation is pinned to the top of the chat list.
--
-- A column rather than the client-only treatment `archived` gets. The difference is
-- what the flag is for: archiving hides a chat you are done with, and living on one
-- device is survivable. Pinning is a statement about which handful of conversations
-- matter, made deliberately, and a pin that vanishes when you open the app on another
-- device -- or after a reinstall -- is worse than no pin at all.
--
-- NOT NULL DEFAULT false, unlike the nullable `jsonb` columns 002 and 003 added.
-- There is no third state to preserve here: every existing row is genuinely not
-- pinned, so a null would mean nothing that false does not already say.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- The list is ordered pinned-first, then by recency, so the index leads with the
-- same three columns in that order. Without it the existing
-- conversations_updated_at_idx still serves the recency half and Postgres sorts the
-- pinned half in memory -- correct, but a sort per request for a column that is
-- almost always false.
CREATE INDEX IF NOT EXISTS conversations_pinned_updated_at_idx
  ON conversations (user_id, pinned DESC, updated_at DESC);

INSERT INTO migrations (name) VALUES ('004_conversation_pinned.sql')
ON CONFLICT (name) DO NOTHING;
