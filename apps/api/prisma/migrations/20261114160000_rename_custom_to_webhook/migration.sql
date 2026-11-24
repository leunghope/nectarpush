-- Rename the channel type `custom` to `webhook` (breaking rename: the adapter
-- type id changed, not just its display name).
--
-- Only existing channel rows are migrated. Historical message rows keep their
-- recorded `channelType` value on purpose — they are an audit trail of what was
-- actually used at send time.
--
-- Rollback:
--   UPDATE "Channel" SET "type" = 'custom' WHERE "type" = 'webhook';

UPDATE "Channel" SET "type" = 'webhook' WHERE "type" = 'custom';
