import { createDatabase, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { ONE_LINE_LOOK_KEY, ONE_LINE_LOOKS, readOneLineLook, toOneLineLook, writeOneLineLook } from './one-line-look';

async function setup() {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  return { database, close: () => executor.close() };
}

describe('how One line looks, kept in the device’s settings', () => {
  it('is the card until the plain bar is chosen', async () => {
    const { database, close } = await setup();
    expect(await readOneLineLook(database)).toBe('card');
    close();
  });

  it('reads back what was written, and the last write wins', async () => {
    const { database, close } = await setup();
    await writeOneLineLook(database, 'plain');
    expect(await readOneLineLook(database)).toBe('plain');
    await writeOneLineLook(database, 'card');
    expect(await readOneLineLook(database)).toBe('card');
    close();
  });

  it('reads a value it does not know as the card', () => {
    expect(toOneLineLook(undefined)).toBe('card');
    expect(toOneLineLook('')).toBe('card');
    expect(toOneLineLook('bubble')).toBe('card');
    expect(toOneLineLook('plain')).toBe('plain');
    expect(ONE_LINE_LOOK_KEY).toBe('one_line_look');
  });

  it('offers Card and Plain, in that order', () => {
    expect(ONE_LINE_LOOKS.map((look) => look.label)).toEqual(['Card', 'Plain']);
  });
});
