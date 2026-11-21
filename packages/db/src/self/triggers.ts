import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { SELF_TABLES, settingsPrefixes } from './tables';

/*
 * Link my devices, capture (spec §3.2): a trigger on every table that travels writes which row changed, and which of its
 * columns, into `self_pending`, in the same SQLite transaction as the row — whichever code made the write, inside a
 * `Database.transaction` or not. `collectSelfChanges` turns them into change-sets later.
 *
 * The triggers are made from the live schema (`PRAGMA table_info`), so a migration's new column is captured once
 * `installSelfCapture` has run again; `migrate` drops them before it runs anything (a column a trigger names could not
 * be dropped) and puts them back after. They stay quiet while `self_state` holds `quiet`: the self channel's own apply,
 * and nothing else, sets it.
 *
 * Only a device with linked devices has them (`self_state` key `capture`); every other device pays nothing.
 */

const PREFIX = 'self_cap_';
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const lit = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** A settings row's class in SQL, first prefix that matches, as `settingsKeyClass` reads it. */
function settingsClassSql(key: string): string {
  const cases = settingsPrefixes().map(([prefix, kind]) => `WHEN substr(${key}, 1, ${prefix.length}) = ${lit(prefix)} THEN ${lit(kind)}`);
  return `(CASE ${cases.join(' ')} ELSE 'replicate' END)`;
}

export async function selfTablesExist(database: Database): Promise<boolean> {
  return (await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'self_state'`)).length > 0;
}

export async function selfCaptureOn(database: Database): Promise<boolean> {
  if (!(await selfTablesExist(database))) return false;
  return (await database.db.values(sql`SELECT 1 FROM self_state WHERE key = 'capture'`)).length > 0;
}

export async function dropSelfTriggers(database: Database): Promise<void> {
  const names = await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'self\\_cap\\_%' ESCAPE '\\'`);
  if (names.length === 0) return;
  await database.execScript(names.map(([name]) => `DROP TRIGGER IF EXISTS ${q(name)};`).join('\n'));
}

/** The four triggers of one table, from its columns as they are now. */
async function triggersFor(database: Database, table: string): Promise<string> {
  const columns = await database.db.values<[string, number]>(sql`SELECT name, pk FROM pragma_table_info(${table}) ORDER BY cid`);
  const keys = columns.filter(([, pk]) => Number(pk) > 0).sort((a, b) => Number(a[1]) - Number(b[1])).map(([name]) => name);
  if (keys.length === 0) throw new Error(`Table ${table} has no primary key and cannot travel to linked devices`);
  const others = columns.map(([name]) => name).filter((name) => !keys.includes(name));
  const pkOf = (ref: 'NEW' | 'OLD') => `json_array(${keys.map((key) => `${ref}.${q(key)}`).join(', ')})`;
  const quiet = `NOT EXISTS (SELECT 1 FROM self_state WHERE key = 'quiet')`;
  const only = (ref: 'NEW' | 'OLD') => (table === 'settings' ? ` AND ${settingsClassSql(`${ref}.key`)} <> 'device'` : '');
  const samePk = keys.map((key) => `OLD.${q(key)} IS NEW.${q(key)}`).join(' AND ');
  const changed = others.length > 0 ? others.map((name) => `OLD.${q(name)} IS NOT NEW.${q(name)}`).join(' OR ') : '0';
  const changedList = others.map((name) => `CASE WHEN OLD.${q(name)} IS NOT NEW.${q(name)} THEN ${lit(name)} END`).join(', ');
  const t = lit(table);
  const name = (what: string) => q(`${PREFIX}${table}_${what}`);
  return [
    `CREATE TRIGGER ${name('i')} AFTER INSERT ON ${q(table)} WHEN ${quiet}${only('NEW')} BEGIN
       INSERT INTO self_pending (tbl, pk, cols) VALUES (${t}, ${pkOf('NEW')}, '*'); END;`,
    `CREATE TRIGGER ${name('d')} AFTER DELETE ON ${q(table)} WHEN ${quiet}${only('OLD')} BEGIN
       INSERT INTO self_pending (tbl, pk, cols) VALUES (${t}, ${pkOf('OLD')}, '-'); END;`,
    others.length > 0
      ? `CREATE TRIGGER ${name('u')} AFTER UPDATE ON ${q(table)} WHEN ${quiet}${only('NEW')} AND (${samePk}) AND (${changed}) BEGIN
       INSERT INTO self_pending (tbl, pk, cols) VALUES (${t}, ${pkOf('NEW')}, json_array(${changedList})); END;`
      : '',
    `CREATE TRIGGER ${name('k')} AFTER UPDATE ON ${q(table)} WHEN ${quiet} AND NOT (${samePk}) BEGIN
       INSERT INTO self_pending (tbl, pk, cols) VALUES (${t}, ${pkOf('OLD')}, '-');
       INSERT INTO self_pending (tbl, pk, cols) VALUES (${t}, ${pkOf('NEW')}, '*'); END;`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Turns capture on for this device (it has linked devices) and makes every trigger again from the schema as it is now.
 * Idempotent; run after every migration.
 */
export async function installSelfCapture(database: Database): Promise<void> {
  await dropSelfTriggers(database);
  const present = new Set((await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(([name]) => name));
  const scripts: string[] = [];
  for (const [table, kind] of Object.entries(SELF_TABLES)) {
    if ((kind !== 'replicate' && kind !== 'seat') || !present.has(table)) continue;
    scripts.push(await triggersFor(database, table));
  }
  try {
    await database.execScript(`BEGIN IMMEDIATE;\nINSERT OR REPLACE INTO self_state (key, value) VALUES ('capture', 'on');\n${scripts.join('\n')}\nCOMMIT;`);
  } catch (error) {
    await database.execScript('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Capture off: no linked devices any more. What is still pending stays until it is collected or cleared. */
export async function removeSelfCapture(database: Database): Promise<void> {
  await dropSelfTriggers(database);
  if (await selfTablesExist(database)) await database.db.run(sql`DELETE FROM self_state WHERE key = 'capture'`);
}
