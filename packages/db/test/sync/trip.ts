import { saveEvent, ownerScope, upsertRate } from '../../src/index';
import { Household, type Device } from './household';

/*
 * A shared event among devices on one in-memory relay (shared events §3): real keys, real invites and claims, real
 * sealing — `Household`'s devices, but sharing an event instead of a workspace. Invented rates on every device:
 * 1 EUR = 17,000 IDR, 1 TRY = 560 IDR, from 1 October 2026.
 */
export class Trip {
  readonly home = new Household();
  bookId = '';
  private readonly events = new Map<Device, string>();

  async device(name: string, appVersion = '0.4.0'): Promise<Device> {
    const device = await this.home.device(name, `workspace-${name}`, 'IDR', appVersion);
    for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
      await upsertRate(device.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
    }
    return device;
  }

  /** `owner` makes "Coast week" in lira and shares it, with these names for people without the app. */
  async share(owner: Device, names: string[] = [], currency = 'TRY'): Promise<string> {
    const eventId = await saveEvent(owner.database, ownerScope(owner.ws), { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
    const { bookId } = await owner.engine.shareEvent(owner.ws, { eventId, currency, personName: owner.name, deviceName: `${owner.name}'s phone`, names });
    this.bookId = bookId;
    this.events.set(owner, eventId);
    return bookId;
  }

  /**
   * `joiner` joins on an invite from `inviter`, claiming the name `claim` or adding its own. Every phone already in
   * syncs first, as their schedulers would have: a member who joined a moment ago invites only once a phone that is
   * already an owner on the relay has heard of them and handed the relay the new owners (`followOwners`).
   */
  async join(joiner: Device, inviter: Device, claim: string | null = null, code?: string): Promise<void> {
    if (!code) await this.settle([...this.events.keys()]);
    const invite = code ?? (await inviter.engine.createEventInvite(this.bookId, { inviterName: inviter.name })).code;
    const preview = await joiner.engine.previewInvite(invite);
    const personId = claim ? preview.event!.people.find((p) => p.name === claim)!.personId : null;
    const { eventId } = await joiner.engine.joinEvent(invite, { ws: joiner.ws, personId, name: claim ?? joiner.name, deviceName: `${joiner.name}'s phone` });
    this.events.set(joiner, eventId);
  }

  eventOf(device: Device): string {
    return this.events.get(device)!;
  }

  /** Every device drains, then every device pulls, three times over: nothing is left in flight. */
  async settle(devices: readonly Device[] = this.home.devices): Promise<void> {
    for (let round = 0; round < 3; round += 1) for (const d of devices) await d.engine.syncOnce(this.bookId);
  }
}
