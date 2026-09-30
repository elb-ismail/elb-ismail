import type { LevelData, Point } from '../data/levelTypes';
import type { EventBus } from '../core/EventBus';
import type { WorldState } from './WorldState';

// One beacon, plantable only at the designated cradle. A planted beacon holds everything within its radius:
// the doorway system asks `protects()` before any change.

export class BeaconSystem {
  constructor(private level: LevelData, private bus: EventBus) {}

  canPlant(ws: WorldState): boolean {
    const c = this.level.beacon.cradle;
    return !ws.beacon.planted && Math.hypot(ws.player.x - c.x, ws.player.n - c.n) <= this.level.beacon.plantRange;
  }

  update(ws: WorldState, plantPressed: boolean): void {
    if (plantPressed && this.canPlant(ws)) {
      ws.beacon.planted = true;
      this.bus.emit({ type: 'beaconPlanted' }, ws.step, ws.time);
    }
  }

  protects(ws: WorldState, p: Point): boolean {
    const c = this.level.beacon.cradle;
    return ws.beacon.planted && Math.hypot(p.x - c.x, p.n - c.n) <= this.level.beacon.radius;
  }
}
