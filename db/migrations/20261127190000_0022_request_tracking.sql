-- Receipts distinguish a reply waiting in the chief's queue from one being worked on.
alter table captures add column message_id text;
-- Grouping is separate from subject_key: every approval retains its own identity.
alter table notifications add column request_key text;
