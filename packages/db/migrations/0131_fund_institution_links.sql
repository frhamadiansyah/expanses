/* A fund's or bond's Institution links to a broker's cash account (owner, 25 Nov 2026): picked from a list of the
   broker cash accounts (subtype 'fund'), or a place with no account of its own typed by name as before. The link is the
   holding's holding_links.broker_account_id, the column a share's broker already lives in; nothing new is stored.

   Each Institution typed before that names exactly one open broker cash account is to be linked to it once
   (`linkFundInstitutionsOnce`, run on open). That needs holding_links (0051), which a migration here cannot assume,
   so this only leaves the mark that asks for it; the open does the linking and takes the mark away. The mark is this
   install's own (`upkeep.`), never sent to a linked device: each device runs this on its own copy.

   This version also exists so a linked device on an older build (Link my devices, 0126) holds every change made from
   it until it updates: an older build lets go of a fund's link to any account each time it opens
   (`moveHeldAtToInstitutions`), and would send that back. holding_links is not shared with a household book. */
INSERT OR REPLACE INTO settings (key, value) VALUES ('upkeep.fund_institution_links', '1');
