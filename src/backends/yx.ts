import { execFile } from "node:child_process";
import type { AgentPolicy, DispatchCandidate, SplitTaskInput, TaskBackend } from "../types.js";

const SPLIT_MARKER = "<!-- inference-worker automatic split -->";

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
  maxYakDepth?: number;
  maxSplitChildren?: number;
  runner?: YxCommandRunner;
  logger?: (message: string) => void;
}

interface CandidateRecord {
  yak: YxYak;
  priority: number;
  kind: "review" | "implementation";
  depth: number;
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

interface YakRecord {
  yak: YxYak;
  root: YxYak;
  depth: number;
  blocked: boolean;
}

function flatten(yaks: YxYak[], root?: YxYak, depth = 0, blocked = false): YakRecord[] {
  return yaks.flatMap((yak) => {
    const blockedByAncestor = blocked && !hasTag(yak, "@implementation-split");
    const blockedHere = blockedByAncestor || hasTag(yak, "@implementation-failed");
    return [
      { yak, root: root ?? yak, depth, blocked: blockedHere },
      ...flatten(yak.children ?? [], root ?? yak, depth + 1, blockedHere),
    ];
  });
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

function descendantsAreTerminal(yak: YxYak): boolean {
  return (yak.children ?? []).every((child) => child.state === "done" && descendantsAreTerminal(child));
}

export class YxTaskBackend implements TaskBackend {
  private readonly repositoryRoot: string;
  private readonly policy: AgentPolicy;
  private readonly maxYakDepth: number;
  private readonly maxSplitChildren: number;
  private readonly runner: YxCommandRunner;
  private readonly logger: (message: string) => void;

  constructor(options: YxTaskBackendOptions) {
    this.repositoryRoot = options.repositoryRoot;
    this.policy = options.policy;
    this.maxYakDepth = options.maxYakDepth ?? 10;
    this.maxSplitChildren = options.maxSplitChildren ?? 5;
    this.runner = options.runner ?? defaultRunner(options.repositoryRoot);
    this.logger = options.logger ?? (() => undefined);
  }

  async listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]> {
    if (input.limit <= 0) return [];
    const raw = await this.runner("yx", ["list", "--format", "json"]);
    const parsed = JSON.parse(raw) as YxYak[];
    const excluded = new Set(input.excludeIds);
    const records: CandidateRecord[] = [];
    for (const { yak, root, depth, blocked } of flatten(parsed)) {
      if (blocked) continue;
      if (!hasTag(root, "@g2g")) continue;
      const priority = priorityFor(root);
      if (priority === undefined) {
        this.logger(`skipping root yak ${root.id}: missing or malformed @priority tag`);
        continue;
      }
      if (yak === root) {
        if (yak.state !== "todo" || excluded.has(yak.id) || !descendantsAreTerminal(yak)) continue;
        records.push({ yak, priority, kind: "review", depth });
        continue;
      }
      if (yak.state !== "todo" || excluded.has(yak.id)) continue;
      records.push({ yak, priority, kind: isReview(yak) ? "review" : "implementation", depth });
    }
    records.sort((left, right) => {
      if (left.priority !== right.priority) return right.priority - left.priority;
      if (left.depth !== right.depth) return right.depth - left.depth;
      if (left.kind !== right.kind) return left.kind === "review" ? -1 : 1;
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

  async recordFailure(id: string, reason: string): Promise<void> {
    const context = await this.getContext(id);
    await this.runner("yx", ["context", id], `${context}\n\n## Implementation attempt\n\n- Status: failed\n- Reason: ${reason}\n`);
    await this.runner("yx", ["tag", "add", id, "@implementation-failed"]);
    await this.runner("yx", ["state", id, "todo"]);
  }

  async splitTask(input: SplitTaskInput): Promise<void> {
    const raw = await this.runner("yx", ["list", "--format", "json"]);
    const records = flatten(JSON.parse(raw) as YxYak[]);
    const target = records.find(({ yak }) => yak.id === input.taskId);
    if (!target) throw new Error(`cannot split unknown yak ${input.taskId}`);
    if (input.plan.proposals.length > this.maxSplitChildren) {
      throw new Error(`split exceeds configured child count of ${this.maxSplitChildren}`);
    }
    if (target.depth + 1 > this.maxYakDepth) {
      throw new Error(`split exceeds configured maximum depth of ${this.maxYakDepth}`);
    }
    const context = await this.getContext(input.taskId);
    if (context.includes(SPLIT_MARKER)) return;

    const attempt = `${context}\n\n## Implementation attempt\n\n- Status: failed\n- Reason: ${input.failureReason}\n`;
    await this.runner("yx", ["context", input.taskId], attempt);
    await this.runner("yx", ["tag", "add", input.taskId, "@implementation-failed"]);
    await this.runner("yx", ["state", input.taskId, "todo"]);

    const childIds: string[] = [];
    for (const [index, proposal] of input.plan.proposals.entries()) {
      const childId = `${input.taskId}-split-${index + 1}`;
      const existing = records.find(({ yak }) => yak.id === childId)?.yak;
      if (!existing) {
        await this.runner("yx", ["add", proposal.name, "--under", input.taskId, "--id", childId, "--format", "ids"]);
      }
      childIds.push(childId);
      if (!existing || !hasTag(existing, "@implementation-split")) {
        await this.runner("yx", ["tag", "add", childId, "@implementation-split"]);
      }
      if (!existing?.context?.trim()) {
        await this.runner("yx", ["context", childId], proposalContext(proposal));
      }
    }

    const currentContext = await this.getContext(input.taskId);
    const history = `${currentContext}\n\n${SPLIT_MARKER}\n\n## Automatic split\n\n- Child IDs: ${childIds.join(", ")}\n- Child count: ${childIds.length}\n`;
    await this.runner("yx", ["context", input.taskId], history);
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

function proposalContext(proposal: SplitTaskInput["plan"]["proposals"][number]): string {
  const list = (values: string[]) => values.map((value) => `- ${value}`).join("\n");
  return [
    "# Goal",
    proposal.goal,
    "",
    "# Scope",
    list(proposal.scope),
    "",
    "# Acceptance Criteria",
    list(proposal.acceptanceCriteria),
    "",
    "# Tests",
    list(proposal.tests),
    "",
    "# Dependencies",
    list(proposal.dependencies),
    "",
    "# Non-Goals",
    list(proposal.nonGoals),
  ].join("\n");
}
