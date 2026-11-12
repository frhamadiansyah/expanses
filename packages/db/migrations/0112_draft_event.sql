/* Event mode (owner, 12 Nov 2026): a captured draft can arrive with its event already picked.

   One nullable column on the phone's own capture queue (draft_transactions is never synced). Read and written by name
   (repos/drafts.ts), so a build from before this one simply never sees it. Additive only. */

ALTER TABLE draft_transactions ADD COLUMN event_id TEXT;
