import type { DoorwayStateId } from '../data/levelTypes';

export type GameEvent =
  | { type: 'cameraCut'; from: string; to: string }
  | { type: 'doorwayChanged'; from: DoorwayStateId; to: DoorwayStateId }
  | { type: 'doorwayHeld'; state: DoorwayStateId }          // every other rule passed, but a beacon protected the doorway
  | { type: 'doorwayRouteVeto'; state: DoorwayStateId }     // every other rule passed, but the swap would cut the way home
  | { type: 'beaconPlanted' }
  | { type: 'objectiveReached'; trip: number }
  | { type: 'homeReached'; trip: number };

export type LoggedEvent = GameEvent & { step: number; t: number };
type Listener = (e: LoggedEvent) => void;

export class EventBus {
  readonly log: LoggedEvent[] = [];
  private listeners: Listener[] = [];

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  emit(e: GameEvent, step: number, t: number): void {
    const logged = { ...e, step, t: +t.toFixed(3) } as LoggedEvent;
    this.log.push(logged);
    for (const fn of this.listeners) {
      try { fn(logged); } catch (err) { console.error('event listener failed', e.type, err); }
    }
  }
}
