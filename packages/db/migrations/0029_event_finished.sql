/* When an event is over.

   An event is a date window, which is not the same as being done with it: a renovation runs past its
   planned end, and a trip is finished the day you fly home. Without this the list only grows, and
   every past event keeps asking to be looked at. Null means still running. */
ALTER TABLE events ADD COLUMN finished_at TEXT;
