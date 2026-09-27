-- Household sharing, task 9a (spec §4.2, §8.6, §11). Unreleased with 0056.
--
-- `synced_at`: when this device last finished a sync of the book (drain, pull and apply) — the status line's "Not
-- synced since …". `unshared_by`: the member who ended the sharing here — the owner who stopped it (from the relay's
-- 410), or this device's own member when it left — for "No longer shared by …".
ALTER TABLE shared_books ADD COLUMN synced_at TEXT;
ALTER TABLE shared_books ADD COLUMN unshared_by TEXT;
