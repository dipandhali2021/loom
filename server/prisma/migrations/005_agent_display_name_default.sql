-- 005_agent_display_name_default.sql
--
-- The assistant's default display name follows the app's rename to Loom.
--
-- `display_name` is what the assistant calls itself in the system prompt
-- (src/prompt.ts), so a column default of the old product name would have every new
-- profile introduce the assistant under a name that appears nowhere in the app.
ALTER TABLE agent_profiles ALTER COLUMN display_name SET DEFAULT 'Loom';

-- Existing rows that still hold the old default are moved with it. This cannot tell
-- a row nobody ever touched from one where the name was typed deliberately -- there
-- is no created_at on this table to compare updated_at against -- so it is a
-- judgement: almost every one of these is an untouched default, and the cost of
-- being wrong is one field retyped in Settings. Skip this statement if the
-- deployment would rather leave user-set values alone.
UPDATE agent_profiles SET display_name = 'Loom' WHERE display_name = 'Mirai';

INSERT INTO migrations (name) VALUES ('005_agent_display_name_default.sql')
ON CONFLICT (name) DO NOTHING;
