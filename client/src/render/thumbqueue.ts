// The hangar's thumbnail jobs: each card's jet loads, then one is drawn per
// frame, in order. A request for another side supersedes every pending job
// (a generation token): a stale job is never drawn and its jet is freed when
// it arrives, so a team switch cannot touch the new side's thumbnails. A
// job also carries its look (the skin): asking for another look of a kind
// supersedes that kind's pending job the same way.

export type ThumbJob<T> = { kind: string; team: string; look: string; jet: T; done: (kind: string) => void };

type Pending<T> = { gen: number; kind: string; team: string; look: string; done: (kind: string) => void; jet: T | null };

export class ThumbQueue<T> {
  private readonly free: (jet: T) => void;
  private gen = 0;
  private team: string | null = null;
  private jobs: Pending<T>[] = [];

  /** free releases a loaded jet that will not be drawn (or was drawn and handed back). */
  constructor(free: (jet: T) => void) {
    this.free = free;
  }

  /**
   * Queues kinds for team (load gives each its jet in its look, looks(kind),
   * default ""); another team cancels everything pending first, another look
   * of a queued kind replaces that kind's job.
   */
  request(kinds: readonly string[], team: string, load: (kind: string, look: string) => Promise<T>, done: (kind: string) => void,
    looks: (kind: string) => string = () => ""): void {
    if (team !== this.team) this.cancel();
    this.team = team;
    const gen = this.gen;
    for (const kind of kinds) {
      const look = looks(kind);
      const old = this.jobs.find((j) => j.kind === kind);
      if (old && old.look === look) continue;
      if (old) {
        this.jobs = this.jobs.filter((j) => j !== old); // still loading: freed when it arrives
        if (old.jet !== null) this.free(old.jet);
      }
      const job: Pending<T> = { gen, kind, team, look, done, jet: null };
      this.jobs.push(job);
      void load(kind, look).then((jet) => {
        if (job.gen === this.gen && this.jobs.includes(job)) job.jet = jet;
        else this.free(jet);
      });
    }
  }

  /** The next job ready to draw, in request order (null while the first one still loads). */
  next(): ThumbJob<T> | null {
    const j = this.jobs[0];
    if (!j || j.jet === null) return null;
    this.jobs.shift();
    return { kind: j.kind, team: j.team, look: j.look, jet: j.jet, done: j.done };
  }

  /** Drops every pending job, freeing the jets already loaded; the ones still loading are freed on arrival. */
  cancel(): void {
    this.gen++;
    for (const j of this.jobs) if (j.jet !== null) this.free(j.jet);
    this.jobs = [];
  }

  get pending(): number {
    return this.jobs.length;
  }
}
