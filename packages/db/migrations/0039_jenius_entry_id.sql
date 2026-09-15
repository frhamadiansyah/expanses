/* The Jenius card is named Jenius Platinum, and its catalogue entry id moved with it.

   A program already linked to the old id would have found no entry to sync against, and would have sat
   on its applied rules for good. The snapshot is left as it was: it is only read to describe what has
   changed since it was applied, and nothing in that description reads the entry's own id or name. */
UPDATE reward_programs SET catalog_entry_id = 'jenius-platinum' WHERE catalog_entry_id = 'jenius-kartu-kredit';
