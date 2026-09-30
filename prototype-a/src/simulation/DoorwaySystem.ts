import type { DoorwayStateId, LevelData } from '../data/levelTypes';
import type { EventBus } from '../core/EventBus';
import { homeReachable } from './RouteGraph';
import { dressingColliders, visiblePropsFor, type WorldState } from './WorldState';

// The changed-doorway rule. The anchor may swap state only when ALL six conditions hold:
//   1 seen   – its current state was seen for rules.seenSeconds while covering >= minScreenFraction of the screen
//   2 left   – it has been out of the camera's view (frustum + occlusion) for rules.unobservedSeconds
//   3 far    – the player is at least rules.minDistance away
//   4 cut    – the player crossed a camera cut AFTER condition 1 was met (memory formed, then a context break).
//              Seeing it again after the cut does not undo this: the high yard camera still shows the wall top
//              as the player walks away, and the rule must hold for that authored framing.
//   5 free   – no planted beacon protects it
//   6 route  – after the swap, a walkable path from the player to the Sanctuary still exists
// Pacing on top of the six: at most rules.maxChangesPerTrip changes per excursion from the Sanctuary.
// Observation is supplied by the camera module each step; this system never looks at rendering.

export interface ObservationFacts { observed: boolean; screenFraction: number; cut: boolean }

const other = (s: DoorwayStateId): DoorwayStateId => (s === 'A' ? 'B' : 'A');

export class DoorwaySystem {
  constructor(private level: LevelData, private bus: EventBus) {}

  update(ws: WorldState, facts: ObservationFacts, dt: number, protectedByBeacon: boolean): boolean {
    const d = ws.doorway, rules = this.level.rules, c = this.level.doorway.center;
    if (facts.cut && d.seenCurrent >= rules.seenSeconds) d.cutAfterSeen = true;
    d.observed = facts.observed;
    d.screenFraction = facts.screenFraction;
    if (facts.observed) {
      d.unobservedFor = 0;
      d.heldNotified = false;
      if (facts.screenFraction >= rules.minScreenFraction) d.seenCurrent += dt;
    } else {
      d.unobservedFor += dt;
    }
    d.distance = Math.hypot(ws.player.x - c.x, ws.player.n - c.n);
    if (d.vetoCooldown > 0) d.vetoCooldown -= dt;

    const check = d.check;
    check.seen = d.seenCurrent >= rules.seenSeconds;
    check.leftView = !facts.observed && d.unobservedFor >= rules.unobservedSeconds;
    check.distance = d.distance >= rules.minDistance;
    check.cutCrossed = d.cutAfterSeen;
    check.notProtected = !protectedByBeacon;
    check.budget = d.changesThisTrip < rules.maxChangesPerTrip;
    check.routeOk = null;

    if (!(check.seen && check.leftView && check.distance && check.cutCrossed && check.budget)) return false;
    if (!check.notProtected) {
      if (!d.heldNotified) { d.heldNotified = true; this.bus.emit({ type: 'doorwayHeld', state: d.state }, ws.step, ws.time); }
      return false;
    }
    if (d.vetoCooldown > 0) { check.routeOk = false; return false; }

    const next = other(d.state), nextProps = visiblePropsFor(this.level, next, true);
    check.routeOk = homeReachable(this.level, nextProps, ws.player, dressingColliders(ws));
    if (!check.routeOk) {
      d.vetoCooldown = 1;
      this.bus.emit({ type: 'doorwayRouteVeto', state: d.state }, ws.step, ws.time);
      return false;
    }
    const from = d.state;
    d.state = next;
    d.enteredByChange = true;
    d.changes++;
    d.changesThisTrip++;
    d.seenCurrent = 0;
    d.cutAfterSeen = false;
    ws.visibleProps = nextProps;
    this.bus.emit({ type: 'doorwayChanged', from, to: next }, ws.step, ws.time);
    return true;
  }
}
