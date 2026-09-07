import type { UiTaskSource, YxTask } from "./types.js";

export type UiCommandRunner = (command: string, args: string[]) => Promise<string>;

interface RawYak {
  id?: string;
  name?: string;
  state?: string;
  context?: string;
  fields?: Record<string, unknown>;
}

export class YxUiReader implements UiTaskSource {
  constructor(private readonly runner: UiCommandRunner) {}

  async list(): Promise<YxTask[]> {
    const parsed = JSON.parse(await this.runner("yx", ["list", "--format", "json"])) as RawYak[];
    return parsed.flatMap((yak) => {
      if (!yak.id || !yak.name) return [];
      const pullRequestUrl = typeof yak.fields?.["pull-request-url"] === "string" ? yak.fields["pull-request-url"] as string : undefined;
      return [{ id: yak.id, title: yak.name, state: yak.state ?? "unknown", ...(yak.context ? { context: yak.context } : {}), ...(pullRequestUrl ? { pullRequestUrl } : {}) }];
    });
  }

  context(id: string): Promise<string> {
    return this.runner("yx", ["context", id, "--show"]);
  }
}
