import type { Game } from '../core/Game';
import type { LoggedEvent } from '../core/EventBus';

// Player-facing text only: objective, one context prompt, short toasts. It never mentions the doorway;
// noticing the change is what the prototype measures.

export class Hud {
  private objective = document.getElementById('objective')!;
  private prompt = document.getElementById('prompt')!;
  private toast = document.getElementById('toast')!;
  private toastUntil = 0;

  constructor(private game: Game) {
    game.bus.on(e => this.onEvent(e));
  }

  private onEvent(e: LoggedEvent): void {
    if (e.type === 'beaconPlanted') this.show('Beacon lit. What stands in its light stays as it is.', 4);
    if (e.type === 'objectiveReached') this.show('Marker reached. Return to the Sanctuary.', 3);
    if (e.type === 'homeReached') this.show(`Home. Trip ${e.trip} complete.`, 3);
  }

  show(text: string, seconds: number): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    this.toastUntil = performance.now() + seconds * 1000;
  }

  update(): void {
    const ws = this.game.ws;
    this.objective.textContent = ws.objective.phase === 'outbound'
      ? 'Walk to the far marker in the yard.'
      : 'Return to the Sanctuary.';
    const canPlant = this.game.beacon.canPlant(ws);
    this.prompt.hidden = !canPlant;
    if (canPlant) this.prompt.textContent = 'E  Plant the beacon';
    if (!this.toast.hidden && performance.now() > this.toastUntil) this.toast.hidden = true;
  }
}
