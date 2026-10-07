// The hangar preview's lifecycle, apart from the DOM and WebGL so it can be
// tested: every open gets a fresh canvas and a fresh stage on it, every close
// disposes that stage and drops the canvas. A stage may end its canvas's GL
// context for good (three's forceContextLoss); nothing ever reuses one.

/** What the hangar asks of its 3D stage (render/hangar3d.ts HangarStage). */
export interface PreviewStage {
  show(kind: string, team: string): void;
  thumbnails(kinds: readonly string[], team: string, done: (kind: string) => void): void;
  dispose(): void;
}

export type PreviewHooks<C> = {
  canvas(): C;                              // a new, never used canvas
  mount(c: C | null): void;                 // put it where the preview goes (null: take it out)
  stage(c: C): PreviewStage;                // may throw (no WebGL): the cards still work
  drawn(kind: string): void;                // a thumbnail is ready
};

export class PreviewLife<C> {
  private readonly hooks: PreviewHooks<C>;
  private stage: PreviewStage | null = null;
  private side = "";       // team|kinds the thumbnails were asked for
  private shown = "";      // kind|team on the stage

  constructor(hooks: PreviewHooks<C>) {
    this.hooks = hooks;
  }

  get open(): boolean {
    return this.stage !== null;
  }

  /** The screen became visible: a new stage on a new canvas, thumbnails, the selection. */
  start(team: string, kinds: readonly string[], sel: string | null): void {
    if (this.stage) return;
    const c = this.hooks.canvas();
    this.hooks.mount(c);
    try {
      this.stage = this.hooks.stage(c);
    } catch {
      this.hooks.mount(null);
      return;
    }
    this.side = this.shown = "";
    this.cards(team, kinds);
    if (sel) this.select(sel, team);
  }

  /** The cards changed (a team switch): their thumbnails, if open. */
  cards(team: string, kinds: readonly string[]): void {
    const side = `${team}|${kinds.join(",")}`;
    if (!this.stage || side === this.side) return;
    this.side = side;
    this.stage.thumbnails(kinds, team, (k) => this.hooks.drawn(k));
  }

  /** The selected jet, if open. */
  select(kind: string, team: string): void {
    const key = `${kind}|${team}`;
    if (!this.stage || key === this.shown) return;
    this.shown = key;
    this.stage.show(kind, team);
  }

  /** The screen closed: the stage goes, and its canvas with it. */
  stop(): void {
    if (!this.stage) return;
    this.stage.dispose();
    this.stage = null;
    this.hooks.mount(null);
  }
}
