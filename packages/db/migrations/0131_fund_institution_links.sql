/* A fund's or bond's Institution links to a broker's cash account (owner, 25 Nov 2026): picked from a list of the
   broker cash accounts (subtype 'fund'), or a place with no account of its own typed by name as before. The link is the
   holding's holding_links.broker_account_id, the column a share's broker already lives in; nothing new is stored.

   Each Institution typed before that names exactly one open broker cash account here — either name holding the other,
   whatever the case ("Mandiri Sekuritas" and a broker's cash called that) — is linked to it once, here. The typed name is
   left as it was. A holding already linked, or one that is the same fund as another holding (a shared security, whose
   pair at one broker must stay one holding), is left alone. A name matching none or several stays a typed name.

   Migration 0129 is followed by 0131: 0130 is kept for the card part payments branch.

   This version also exists so a linked device on an older build (Link my devices, 0126) holds every change made from
   it until it updates: an older build lets go of a fund's link to any account each time it opens
   (`moveHeldAtToInstitutions`), and would send that back. holding_links is not shared with a household book. */
INSERT INTO holding_links (account_id, workspace_id, security_id, broker_account_id, created_at)
SELECT p.account_id, p.workspace_id, NULL,
  (SELECT b.id FROM accounts b
    WHERE b.workspace_id = p.workspace_id AND b.kind = 'asset' AND b.subtype = 'fund' AND b.parent_id IS NULL AND b.archived_at IS NULL
      AND (instr(lower(trim(b.name)), lower(trim(json_extract(p.coretax_fields_json, '$.inst')))) > 0
        OR instr(lower(trim(json_extract(p.coretax_fields_json, '$.inst'))), lower(trim(b.name))) > 0)),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM asset_profiles p
JOIN accounts h ON h.id = p.account_id AND h.workspace_id = p.workspace_id
WHERE p.asset_kind IN ('fund', 'bond')
  AND h.kind = 'asset' AND h.subtype = 'investment'
  AND json_valid(p.coretax_fields_json)
  AND trim(coalesce(json_extract(p.coretax_fields_json, '$.inst'), '')) <> ''
  AND (SELECT count(*) FROM accounts b
    WHERE b.workspace_id = p.workspace_id AND b.kind = 'asset' AND b.subtype = 'fund' AND b.parent_id IS NULL AND b.archived_at IS NULL
      AND trim(b.name) <> ''
      AND (instr(lower(trim(b.name)), lower(trim(json_extract(p.coretax_fields_json, '$.inst')))) > 0
        OR instr(lower(trim(json_extract(p.coretax_fields_json, '$.inst'))), lower(trim(b.name))) > 0)) = 1
  AND NOT EXISTS (SELECT 1 FROM holding_links l WHERE l.account_id = p.account_id AND (l.broker_account_id IS NOT NULL OR l.security_id IS NOT NULL))
ON CONFLICT (account_id) DO UPDATE SET broker_account_id = excluded.broker_account_id;
