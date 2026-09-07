{pkgs ? import <nixpkgs> {}}:
let
  module = {config, lib, ...}:
    import ./module.nix {
      inherit config lib;
      package = pkgs.hello;
    };

  evaluate = settings:
    (pkgs.lib.evalModules {
      modules = [
        ({lib, ...}: {
          options.launchd.user.agents = lib.mkOption {
            type = lib.types.attrs;
            default = {};
          };
        })
        module
        {services.inference-worker = settings;}
      ];
    }).config;

  defaults = evaluate {
    enable = true;
    repositoryRoot = /tmp;
    inference.endpoint = "http://127.0.0.1:8081/v1";
  };

  overrides = evaluate {
    enable = true;
    repositoryRoot = /tmp;
    inference.endpoint = "http://127.0.0.1:8081/v1";
    agent = {
      model = "agent-model";
      maxRunTimeSeconds = 12;
      bashTimeoutMs = 34;
      maxOutputTokens = 56;
      cleanupGraceSeconds = 78;
    };
    dispatcher = {
      maxYakDepth = 7;
      maxSplitChildren = 3;
      splitEnabled = false;
      plannerModel = "planner-model";
      plannerMaxRunTimeSeconds = 90;
      plannerMaxOutputTokens = 123;
    };
  };

  environment = config: config.launchd.user.agents.inference-worker.serviceConfig.EnvironmentVariables;
in {
  assertions = [
    (assert (environment defaults).AGENT_MODEL == "omlx/qwen3.8-27b"; true)
    (assert (environment defaults).AGENT_MAX_RUN_TIME_SECONDS == "7200"; true)
    (assert (environment defaults).AGENT_BASH_TIMEOUT_MS == "3600000"; true)
    (assert (environment defaults).AGENT_MAX_OUTPUT_TOKENS == "16384"; true)
    (assert (environment defaults).WORK_ITEM_CLEANUP_GRACE_SECONDS == "300"; true)
    (assert (environment defaults).DISPATCHER_MAX_YAK_DEPTH == "10"; true)
    (assert (environment defaults).DISPATCHER_MAX_SPLIT_CHILDREN == "5"; true)
    (assert (environment defaults).DISPATCHER_SPLIT_ENABLED == "true"; true)
    (assert (environment defaults).DISPATCHER_PLANNER_MODEL == "omlx/qwen3.8-27b"; true)
    (assert (environment defaults).DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS == "600"; true)
    (assert (environment defaults).DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS == "4096"; true)
    (assert (environment overrides).AGENT_MAX_RUN_TIME_SECONDS == "12"; true)
    (assert (environment overrides).AGENT_MODEL == "agent-model"; true)
    (assert (environment overrides).AGENT_BASH_TIMEOUT_MS == "34"; true)
    (assert (environment overrides).AGENT_MAX_OUTPUT_TOKENS == "56"; true)
    (assert (environment overrides).WORK_ITEM_CLEANUP_GRACE_SECONDS == "78"; true)
    (assert (environment overrides).DISPATCHER_MAX_YAK_DEPTH == "7"; true)
    (assert (environment overrides).DISPATCHER_MAX_SPLIT_CHILDREN == "3"; true)
    (assert (environment overrides).DISPATCHER_SPLIT_ENABLED == "false"; true)
    (assert (environment overrides).DISPATCHER_PLANNER_MODEL == "planner-model"; true)
    (assert (environment overrides).DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS == "90"; true)
    (assert (environment overrides).DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS == "123"; true)
  ];
  defaults = environment defaults;
  overrides = environment overrides;
}
