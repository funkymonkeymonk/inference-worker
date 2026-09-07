{config, lib, package, ...}: let
  cfg = config.services.inference-worker;
in {
  options.services.inference-worker = {
    enable = lib.mkEnableOption "the Temporal inference worker";

    package = lib.mkOption {
      type = lib.types.package;
      default = package;
      description = "Inference worker package to run.";
    };

    temporal = {
      address = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1:7233";
        description = "Temporal frontend address.";
      };
      namespace = lib.mkOption {
        type = lib.types.str;
        default = "inference";
        description = "Temporal namespace for inference workflows.";
      };
    };

    taskQueue = lib.mkOption {
      type = lib.types.str;
      default = "inference-worker";
      description = "Temporal task queue polled by the worker.";
    };

    repositoryRoot = lib.mkOption {
      type = lib.types.path;
      description = "Repository containing the yaks and agent workspaces.";
      example = "/Users/me/src/project";
    };

    taskBackend = lib.mkOption {
      type = lib.types.enum ["yx"];
      default = "yx";
      description = "Configured task backend.";
    };

    dispatcher = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Start the repository's singleton task dispatcher workflow.";
      };
      pollIntervalMs = lib.mkOption {
        type = lib.types.ints.positive;
        default = 60000;
        description = "Dispatcher polling interval in milliseconds.";
      };
      maxConcurrentImplementations = lib.mkOption {
        type = lib.types.ints.positive;
        default = 1;
        description = "Maximum concurrent implementation workflows.";
      };
    };

    inference.endpoint = lib.mkOption {
      type = lib.types.str;
      description = "OpenAI-compatible inference endpoint.";
      example = "http://127.0.0.1:8081/v1";
    };

    maxConcurrentActivities = lib.mkOption {
      type = lib.types.ints.positive;
      default = 1;
      description = "Maximum number of inference Activities executed concurrently.";
    };

    home = lib.mkOption {
      type = lib.types.path;
      default = "/var/empty";
      description = "HOME for task tools and launchd execution.";
    };

    agent = {
      model = lib.mkOption {
        type = lib.types.nonEmptyStr;
        default = "omlx/qwen3.8-27b";
        description = "Default model used by implementation Activities.";
      };
      maxRunTimeSeconds = lib.mkOption {
        type = lib.types.ints.positive;
        default = 7200;
        description = "Maximum implementation Activity run time in seconds.";
      };
      bashTimeoutMs = lib.mkOption {
        type = lib.types.ints.positive;
        default = 3600000;
        description = "Default bash tool timeout in milliseconds.";
      };
      maxOutputTokens = lib.mkOption {
        type = lib.types.ints.positive;
        default = 16384;
        description = "Maximum output tokens per agent model turn.";
      };
      cleanupGraceSeconds = lib.mkOption {
        type = lib.types.ints.positive;
        default = 300;
        description = "Grace period for workspace cleanup in seconds.";
      };
    };

    dispatcher.maxYakDepth = lib.mkOption {
      type = lib.types.ints.positive;
      default = 10;
      description = "Maximum root depth for automatic yak splitting.";
    };
    dispatcher.maxSplitChildren = lib.mkOption {
      type = lib.types.ints.positive;
      default = 5;
      description = "Maximum child yaks created for one failed yak.";
    };
    dispatcher.splitEnabled = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable automatic failed-yak planning and splitting.";
    };
    dispatcher.plannerModel = lib.mkOption {
      type = lib.types.nullOr lib.types.nonEmptyStr;
      default = null;
      description = "Planner model; defaults to the agent model when unset.";
    };
    dispatcher.plannerMaxRunTimeSeconds = lib.mkOption {
      type = lib.types.ints.positive;
      default = 600;
      description = "Maximum planner Activity run time in seconds.";
    };
    dispatcher.plannerMaxOutputTokens = lib.mkOption {
      type = lib.types.ints.positive;
      default = 4096;
      description = "Maximum planner response tokens.";
    };

  };

  config = lib.mkIf cfg.enable {
    launchd.user.agents.inference-worker = {
      command = "${cfg.package}/bin/inference-worker";
      serviceConfig = {
        RunAtLoad = true;
        KeepAlive = true;
      WorkingDirectory = cfg.repositoryRoot;
        StandardOutPath = "/tmp/inference-worker.log";
        StandardErrorPath = "/tmp/inference-worker.error.log";
        EnvironmentVariables = {
          INFERENCE_ENDPOINT = cfg.inference.endpoint;
          TEMPORAL_ADDRESS = cfg.temporal.address;
          TEMPORAL_NAMESPACE = cfg.temporal.namespace;
          TEMPORAL_TASK_QUEUE = cfg.taskQueue;
          WORKER_ACTIVITY_SLOTS = toString cfg.maxConcurrentActivities;
          REPOSITORY_ROOT = cfg.repositoryRoot;
          TASK_BACKEND = cfg.taskBackend;
           DISPATCHER_ENABLED = lib.boolToString cfg.dispatcher.enable;
           DISPATCHER_POLL_INTERVAL_MS = toString cfg.dispatcher.pollIntervalMs;
           DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS = toString cfg.dispatcher.maxConcurrentImplementations;
           AGENT_MODEL = cfg.agent.model;
           AGENT_MAX_RUN_TIME_SECONDS = toString cfg.agent.maxRunTimeSeconds;
           AGENT_BASH_TIMEOUT_MS = toString cfg.agent.bashTimeoutMs;
           AGENT_MAX_OUTPUT_TOKENS = toString cfg.agent.maxOutputTokens;
           WORK_ITEM_CLEANUP_GRACE_SECONDS = toString cfg.agent.cleanupGraceSeconds;
           DISPATCHER_MAX_YAK_DEPTH = toString cfg.dispatcher.maxYakDepth;
           DISPATCHER_MAX_SPLIT_CHILDREN = toString cfg.dispatcher.maxSplitChildren;
           DISPATCHER_SPLIT_ENABLED = lib.boolToString cfg.dispatcher.splitEnabled;
           DISPATCHER_PLANNER_MODEL = if cfg.dispatcher.plannerModel == null then cfg.agent.model else cfg.dispatcher.plannerModel;
           DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS = toString cfg.dispatcher.plannerMaxRunTimeSeconds;
           DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS = toString cfg.dispatcher.plannerMaxOutputTokens;
           HOME = cfg.home;
          PATH = "/run/current-system/sw/bin:/usr/bin:/bin";
        };
      };
    };
  };
}
