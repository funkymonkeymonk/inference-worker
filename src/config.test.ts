import assert from "node:assert/strict";
import test from "node:test";
import { configFromEnvironment } from "./config.js";

test("uses safe defaults for worker policy", () => {
  const config = configFromEnvironment({ AGENT_MODEL: "agent-default" });

  assert.deepEqual(config, {
    agent: {
      model: "agent-default",
      maxRunTimeSeconds: 7200,
      bashTimeoutMs: 3600000,
      maxOutputTokens: 16384,
    },
    dispatcher: {
      maxYakDepth: 10,
      maxSplitChildren: 5,
      splitEnabled: true,
      plannerModel: "agent-default",
      plannerMaxRunTimeSeconds: 600,
      plannerMaxOutputTokens: 4096,
    },
  });
});

test("preserves explicit policy overrides", () => {
  const config = configFromEnvironment({
    AGENT_MODEL: "agent-model",
    AGENT_MAX_RUN_TIME_SECONDS: "12",
    AGENT_BASH_TIMEOUT_MS: "34",
    AGENT_MAX_OUTPUT_TOKENS: "56",
    DISPATCHER_MAX_YAK_DEPTH: "7",
    DISPATCHER_MAX_SPLIT_CHILDREN: "3",
    DISPATCHER_SPLIT_ENABLED: "false",
    DISPATCHER_PLANNER_MODEL: "planner-model",
    DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS: "78",
    DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS: "90",
  });

  assert.deepEqual(config, {
    agent: { model: "agent-model", maxRunTimeSeconds: 12, bashTimeoutMs: 34, maxOutputTokens: 56 },
    dispatcher: {
      maxYakDepth: 7,
      maxSplitChildren: 3,
      splitEnabled: false,
      plannerModel: "planner-model",
      plannerMaxRunTimeSeconds: 78,
      plannerMaxOutputTokens: 90,
    },
  });
});

test("defaults the planner model to the agent model", () => {
  assert.equal(configFromEnvironment({ AGENT_MODEL: "shared-model" }).dispatcher.plannerModel, "shared-model");
});

test("rejects invalid policy values", () => {
  for (const key of [
    "AGENT_MAX_RUN_TIME_SECONDS",
    "AGENT_BASH_TIMEOUT_MS",
    "AGENT_MAX_OUTPUT_TOKENS",
    "DISPATCHER_MAX_YAK_DEPTH",
    "DISPATCHER_MAX_SPLIT_CHILDREN",
    "DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS",
    "DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS",
  ]) {
    assert.throws(() => configFromEnvironment({ [key]: "0" }), new RegExp(key));
    assert.throws(() => configFromEnvironment({ [key]: "1.5" }), new RegExp(key));
    assert.throws(() => configFromEnvironment({ [key]: "9007199254740992" }), new RegExp(key));
  }

  assert.throws(() => configFromEnvironment({ DISPATCHER_SPLIT_ENABLED: "yes" }), /DISPATCHER_SPLIT_ENABLED/);
});
