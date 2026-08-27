-- 003_message_attachments.sql
--
-- What the user attached to a turn: photos and files, as the upload pipeline left
-- them (see server/src/attachments.ts for the shape).
--
-- On the message for the same reason `sources` is: an attachment has no life outside
-- the turn that carried it, nothing queries across them, and the app reads them in the
-- request that reads the message.
--
-- What is stored is a list of URLs and, for a document, the text that was extracted
-- from it -- never the file itself. The bytes live in the pipeline's storage; this
-- server only ever passed them through.
--
-- Nullable with no default, so an existing row keeps meaning "sent before attachments
-- existed" rather than "sent with none", which is what an empty array would say.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb;

INSERT INTO migrations (name) VALUES ('003_message_attachments.sql')
ON CONFLICT (name) DO NOTHING;
