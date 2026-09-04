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

    workingDirectory = lib.mkOption {
      type = lib.types.path;
      default = "/var/empty";
      description = "Working directory for the worker process.";
    };
  };

  config = lib.mkIf cfg.enable {
    launchd.user.agents.inference-worker = {
      command = "${cfg.package}/bin/inference-worker";
      serviceConfig = {
        RunAtLoad = true;
        KeepAlive = true;
        WorkingDirectory = cfg.workingDirectory;
        StandardOutPath = "/tmp/inference-worker.log";
        StandardErrorPath = "/tmp/inference-worker.error.log";
        EnvironmentVariables = {
          INFERENCE_ENDPOINT = cfg.inference.endpoint;
          TEMPORAL_ADDRESS = cfg.temporal.address;
          TEMPORAL_NAMESPACE = cfg.temporal.namespace;
          TEMPORAL_TASK_QUEUE = cfg.taskQueue;
          WORKER_ACTIVITY_SLOTS = toString cfg.maxConcurrentActivities;
        };
      };
    };
  };
}
