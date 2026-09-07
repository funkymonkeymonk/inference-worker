const DEFAULT_AGENT_MODEL = "omlx/qwen3.8-27b";

export interface WorkerConfig {
  agent: {
    model: string;
    maxRunTimeSeconds: number;
    bashTimeoutMs: number;
    maxOutputTokens: number;
  };
  dispatcher: {
    maxYakDepth: number;
    maxSplitChildren: number;
    splitEnabled: boolean;
    plannerModel: string;
    plannerMaxRunTimeSeconds: number;
    plannerMaxOutputTokens: number;
  };
}

function positiveInteger(environment: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = environment[key];
  if (value === undefined) return fallback;
  if (value.trim() === "") throw new Error(`${key} must be a positive safe integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive safe integer`);
  return parsed;
}

function booleanValue(environment: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = environment[key];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be either true or false`);
}

function modelValue(environment: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = environment[key] ?? fallback;
  if (!value.trim()) throw new Error(`${key} must not be empty`);
  return value;
}

export function configFromEnvironment(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const agentModel = modelValue(environment, "AGENT_MODEL", DEFAULT_AGENT_MODEL);
  return {
    agent: {
      model: agentModel,
      maxRunTimeSeconds: positiveInteger(environment, "AGENT_MAX_RUN_TIME_SECONDS", 7200),
      bashTimeoutMs: positiveInteger(environment, "AGENT_BASH_TIMEOUT_MS", 3600000),
      maxOutputTokens: positiveInteger(environment, "AGENT_MAX_OUTPUT_TOKENS", 16384),
    },
    dispatcher: {
      maxYakDepth: positiveInteger(environment, "DISPATCHER_MAX_YAK_DEPTH", 10),
      maxSplitChildren: positiveInteger(environment, "DISPATCHER_MAX_SPLIT_CHILDREN", 5),
      splitEnabled: booleanValue(environment, "DISPATCHER_SPLIT_ENABLED", true),
      plannerModel: modelValue(environment, "DISPATCHER_PLANNER_MODEL", agentModel),
      plannerMaxRunTimeSeconds: positiveInteger(environment, "DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS", 600),
      plannerMaxOutputTokens: positiveInteger(environment, "DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS", 4096),
    },
  };
}
