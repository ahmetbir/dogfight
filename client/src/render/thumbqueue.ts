// The hangar's thumbnail jobs: each card's jet loads, then one is drawn per
// frame, in order. A request for another side supersedes every pending job
// (a generation token): a stale job is never drawn and its jet is freed when
// it arrives, so a team switch cannot touch the new side's thumbnails.

export type ThumbJob<T> = { kind: string; team: string; jet: T; done: (kind: string) => void };

type Pending<T> = { gen: number; kind: string; team: string; done: (kind: string) => void; jet: T | null };

export class ThumbQueue<T> {
  private readonly free: (jet: T) => void;
  private gen = 0;
  private team: string | null = null;
  private jobs: Pending<T>[] = [];

  /** free releases a loaded jet that will not be drawn (or was drawn and handed back). */
  constructor(free: (jet: T) => void) {
    this.free = free;
  }

  /** Queues kinds for team (load gives each its jet); another team cancels everything pending first. */
  request(kinds: readonly string[], team: string, load: (kind: string) => Promise<T>, done: (kind: string) => void): void {
    if (team !== this.team) this.cancel();
    this.team = team;
    const gen = this.gen;
    for (const kind of kinds) {
      if (this.jobs.some((j) => j.kind === kind)) continue;
      const job: Pending<T> = { gen, kind, team, done, jet: null };
      this.jobs.push(job);
      void load(kind).then((jet) => {
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
    return { kind: j.kind, team: j.team, jet: j.jet, done: j.done };
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
