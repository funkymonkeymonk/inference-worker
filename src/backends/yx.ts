import { execFile } from "node:child_process";
import type { AgentPolicy, DispatchCandidate, TaskBackend } from "../types.js";

export interface YxYak {
  id: string;
  name: string;
  state: string;
  tags?: string[];
  context?: string;
  createdAt?: string;
  children?: YxYak[];
}

export type YxCommandRunner = (command: string, args: string[], input?: string) => Promise<string>;

interface YxTaskBackendOptions {
  repositoryRoot: string;
  policy: AgentPolicy;
  runner?: YxCommandRunner;
  logger?: (message: string) => void;
}

interface CandidateRecord {
  yak: YxYak;
  priority: number;
  kind: "review" | "implementation";
}

function defaultRunner(repositoryRoot: string): YxCommandRunner {
  return (command, args, input) => new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

function flatten(yaks: YxYak[]): YxYak[] {
  return yaks.flatMap((yak) => [yak, ...flatten(yak.children ?? [])]);
}

function priorityFor(yak: YxYak): number | undefined {
  const tag = (yak.tags ?? []).find((value) => /^@?priority:-?\d+$/.test(value));
  if (!tag) return undefined;
  const priority = Number(tag.replace(/^@priority:/, "").replace(/^priority:/, ""));
  return Number.isSafeInteger(priority) ? priority : undefined;
}

function hasTag(yak: YxYak, tag: string): boolean {
  return (yak.tags ?? []).some((value) => value === tag || value === tag.slice(1));
}

function isReview(yak: YxYak): boolean {
  return /CHANGES_REQUESTED/i.test(yak.context ?? "") && !/resolved|addressed|closed/i.test(yak.context ?? "");
}

export class YxTaskBackend implements TaskBackend {
  private readonly repositoryRoot: string;
  private readonly policy: AgentPolicy;
  private readonly runner: YxCommandRunner;
  private readonly logger: (message: string) => void;

  constructor(options: YxTaskBackendOptions) {
    this.repositoryRoot = options.repositoryRoot;
    this.policy = options.policy;
    this.runner = options.runner ?? defaultRunner(options.repositoryRoot);
    this.logger = options.logger ?? (() => undefined);
  }

  async listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]> {
    if (input.limit <= 0) return [];
    const raw = await this.runner("yx", ["list", "--format", "json"]);
    const parsed = JSON.parse(raw) as YxYak[];
    const excluded = new Set(input.excludeIds);
    const records: CandidateRecord[] = [];
    for (const yak of flatten(parsed)) {
      if (yak.state !== "todo" || excluded.has(yak.id) || !hasTag(yak, "@g2g")) continue;
      const priority = priorityFor(yak);
      if (priority === undefined) {
        this.logger(`skipping yak ${yak.id}: missing or malformed @priority tag`);
        continue;
      }
      records.push({ yak, priority, kind: isReview(yak) ? "review" : "implementation" });
    }
    records.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "review" ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      const leftCreated = left.yak.createdAt ?? "";
      const rightCreated = right.yak.createdAt ?? "";
      return leftCreated.localeCompare(rightCreated) || left.yak.id.localeCompare(right.yak.id);
    });
    return records.slice(0, input.limit).map(({ yak, kind }) => ({
      id: yak.id,
      title: yak.name,
      context: yak.context ?? "",
      kind,
      workflowInput: {
        taskId: yak.id,
        title: yak.name,
        context: yak.context ?? "",
        repositoryRoot: this.repositoryRoot,
        policy: this.policy,
      },
    }));
  }

  async claim(id: string): Promise<void> {
    await this.runner("yx", ["start", id]);
  }

  async release(id: string, _reason: string): Promise<void> {
    await this.runner("yx", ["state", id, "todo"]);
  }

  async markDone(id: string): Promise<void> {
    await this.runner("yx", ["done", id]);
  }

  async getContext(id: string): Promise<string> {
    return this.runner("yx", ["context", id, "--show"]);
  }

  async attachPullRequest(id: string, url: string): Promise<void> {
    await this.runner("yx", ["field", id, "pull-request-url"], url);
  }
}
