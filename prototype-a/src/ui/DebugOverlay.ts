import type { Game } from '../core/Game';

// F3 / ?debug=1. Shows the six doorway conditions live, the camera, the beacon and recent events.

const mark = (b: boolean | null) => (b === null ? '·' : b ? '✓' : '✗');

export class DebugOverlay {
  private el = document.getElementById('debug')!;
  private frames: number[] = [];

  constructor(private game: Game) {}

  get visible(): boolean { return !this.el.hidden; }
  set visible(v: boolean) { this.el.hidden = !v; }

  update(frameSeconds: number, faded: number, render: { calls: number; triangles: number }): void {
    if (this.el.hidden) return;
    this.frames.push(frameSeconds); if (this.frames.length > 60) this.frames.shift();
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length, g = this.game, ws = g.ws, d = ws.doorway, c = d.check, r = g.level.rules;
    const st = g.level.doorway.states[d.state];
    const rows = [
      `<b>Prototype A</b>  ${avg > 0 ? (1 / avg).toFixed(0) : '–'} fps   step ${ws.step}`,
      `draw calls ${render.calls}   triangles ${render.triangles}`,
      `camera <b>${ws.camera.active}</b>  cuts ${ws.camera.cuts}${g.player.holdYaw !== null ? '  (input held from previous camera)' : ''}`,
      `player ${ws.player.x.toFixed(1)}, ${ws.player.n.toFixed(1)}   faded occluders ${faded}`,
      `<hr>doorway <b>${d.state}</b>: ${st.label}${d.enteredByChange ? ' (changed)' : ''}   changes ${d.changes}`,
      `observed ${d.observed ? 'yes' : 'no'}   screen ${(d.screenFraction * 100).toFixed(1)}%`,
      `${mark(c.seen)} 1 seen ${d.seenCurrent.toFixed(1)} / ${r.seenSeconds} s`,
      `${mark(c.leftView)} 2 out of view ${d.unobservedFor.toFixed(1)} / ${r.unobservedSeconds} s`,
      `${mark(c.distance)} 3 distance ${d.distance.toFixed(1)} / ${r.minDistance} m`,
      `${mark(c.cutCrossed)} 4 camera cut after seen`,
      `${mark(c.notProtected)} 5 not held by beacon`,
      `${mark(c.routeOk)} 6 way home survives swap`,
      `${mark(c.budget)} pacing: ${d.changesThisTrip}/${r.maxChangesPerTrip} this trip`,
      `<hr>beacon ${ws.beacon.planted ? 'planted' : 'not planted'}   trips ${ws.objective.trips}   phase ${ws.objective.phase}`,
      `<hr>${g.bus.log.slice(-6).map(e => `${e.t.toFixed(1)}s ${e.type}${'to' in e ? ' → ' + e.to : ''}`).join('<br>')}`,
    ];
    this.el.innerHTML = rows.join('<br>');
  }
}
