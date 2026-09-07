{pkgs, ...}: let
  tempoRelease =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin"
    then {
      url = "https://github.com/galaxy-io/tempo/releases/download/v0.1.14/tempo_darwin_arm64.tar.gz";
      hash = "sha256-/ihnOm9BbvCriiw4Yfti6+GbflluvBqC+SLF1EF6Vh0=";
    }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux"
    then {
      url = "https://github.com/galaxy-io/tempo/releases/download/v0.1.14/tempo_linux_amd64.tar.gz";
      hash = "sha256-rBPy48PBmN9gL4H9CUMujW3LlzBEQidj0avnaidGQKo=";
    }
    else throw "tempo does not provide a binary for ${pkgs.stdenv.hostPlatform.system}";

  tempo = pkgs.stdenv.mkDerivation {
    pname = "tempo";
    version = "0.1.14";
    src = pkgs.fetchurl tempoRelease;
    sourceRoot = ".";
    dontConfigure = true;
    dontBuild = true;

    installPhase = ''
      install -Dm755 tempo $out/bin/tempo
    '';
  };

  workerPolicyEnvironment = ''
    export AGENT_MODEL="''${AGENT_MODEL-omlx/qwen3.8-27b}"
    export AGENT_MAX_RUN_TIME_SECONDS="''${AGENT_MAX_RUN_TIME_SECONDS-7200}"
    export AGENT_BASH_TIMEOUT_MS="''${AGENT_BASH_TIMEOUT_MS-3600000}"
    export AGENT_MAX_OUTPUT_TOKENS="''${AGENT_MAX_OUTPUT_TOKENS-16384}"
    export WORK_ITEM_CLEANUP_GRACE_SECONDS="''${WORK_ITEM_CLEANUP_GRACE_SECONDS-300}"
    export DISPATCHER_MAX_YAK_DEPTH="''${DISPATCHER_MAX_YAK_DEPTH-10}"
    export DISPATCHER_MAX_SPLIT_CHILDREN="''${DISPATCHER_MAX_SPLIT_CHILDREN-5}"
    export DISPATCHER_SPLIT_ENABLED="''${DISPATCHER_SPLIT_ENABLED-true}"
    export DISPATCHER_PLANNER_MODEL="''${DISPATCHER_PLANNER_MODEL-''${AGENT_MODEL}}"
    export DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS="''${DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS-600}"
    export DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS="''${DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS-4096}"
  '';

in {
  packages = [
    pkgs.nodejs
    pkgs.yx
    pkgs.git
    pkgs.jujutsu
    pkgs.temporal-cli
    tempo
  ];

  services.temporal = {
    enable = true;
    ip = "127.0.0.1";
    port = 7233;
    namespaces = ["inference" "integration-inference"];

    state.ephemeral = false;

    ui = {
      enable = true;
      ip = "127.0.0.1";
      port = 8233;
    };
  };

  processes.worker.exec = ''
    ${workerPolicyEnvironment}
    export PATH="''${PATH}:/run/current-system/sw/bin"
    temporal_address="''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}"
    export INFERENCE_ENDPOINT="''${INFERENCE_ENDPOINT:-http://127.0.0.1:8081/v1}"
    until temporal operator cluster health --address "$temporal_address" >/dev/null 2>&1; do sleep 1; done
    TEMPORAL_ADDRESS="$temporal_address" npm run build && \
    TEMPORAL_ADDRESS="$temporal_address" npm start
  '';

  tasks = {
    "worker:build" = {
      description = "Build the TypeScript worker";
      exec = "npm run build";
    };

    "worker:test" = {
      description = "Run worker tests";
      exec = "npm test";
    };

    "integration:test" = {
      description = "Build and run the Temporal WorkItem integration test (start devenv up -d first, or set INTEGRATION_TEMPORAL_ADDRESS)";
      exec = ''
        ${workerPolicyEnvironment}
        export PATH="''${PATH}:/run/current-system/sw/bin"
        temporal_address="''${INTEGRATION_TEMPORAL_ADDRESS:-''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}}" && \
        until temporal operator cluster health --address "$temporal_address" >/dev/null 2>&1; do sleep 1; done && \
        npm run build && \
        npm run test:integration
      '';
    };

    "integration:worker-shaves-yak" = {
      description = "Start the worker and verify it dispatches and completes a temporary yx yak";
      exec = ''
        ${workerPolicyEnvironment}
        export PATH="''${PATH}:/run/current-system/sw/bin"
        temporal_address="''${INTEGRATION_TEMPORAL_ADDRESS:-''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}}" && \
        until temporal operator cluster health --address "$temporal_address" >/dev/null 2>&1; do sleep 1; done && \
        npm run build && \
        npm run test:worker-integration
      '';
    };

    "dispatch:run-once" = {
      description = "Start one worker and dispatch one eligible yak";
      exec = ''
        ${workerPolicyEnvironment}
        export PATH="''${PATH}:/run/current-system/sw/bin"
        temporal_address="''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}" &&
        inference_endpoint="''${INFERENCE_ENDPOINT:-http://127.0.0.1:8081/v1}" &&
        temporal operator cluster health --address "$temporal_address" &&
        npm run build && {
          task_queue="manual-dispatch-$$"
          TEMPORAL_ADDRESS="$temporal_address" INFERENCE_ENDPOINT="$inference_endpoint" DISPATCHER_ENABLED=false TEMPORAL_TASK_QUEUE="$task_queue" WORKER_ACTIVITY_SLOTS=1 npm start &
          worker_pid=$!
          trap 'kill "$worker_pid" 2>/dev/null || true; wait "$worker_pid" 2>/dev/null || true' EXIT INT TERM
          sleep 1
          TEMPORAL_ADDRESS="$temporal_address" TEMPORAL_TASK_QUEUE="$task_queue" npm run dispatch
        }
      '';
    };

    "worker:start" = {
      description = "Start the Temporal worker";
      exec = ''
        ${workerPolicyEnvironment}
        export PATH="''${PATH}:/run/current-system/sw/bin"
        temporal_address="''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}"
        export INFERENCE_ENDPOINT="''${INFERENCE_ENDPOINT:-http://127.0.0.1:8081/v1}"
        until temporal operator cluster health --address "$temporal_address" >/dev/null 2>&1; do sleep 1; done
        TEMPORAL_ADDRESS="$temporal_address" npm start
      '';
    };

    "worker:start:dev" = {
      description = "Start the Temporal worker from TypeScript source";
      exec = ''
        ${workerPolicyEnvironment}
        export PATH="''${PATH}:/run/current-system/sw/bin"
        temporal_address="''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}"
        export INFERENCE_ENDPOINT="''${INFERENCE_ENDPOINT:-http://127.0.0.1:8081/v1}"
        until temporal operator cluster health --address "$temporal_address" >/dev/null 2>&1; do sleep 1; done
        TEMPORAL_ADDRESS="$temporal_address" npm run dev
      '';
    };

    "worker:client" = {
      description = "Submit a test inference workflow";
      exec = ''
        temporal_address="''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}"
        until temporal operator cluster health --address "$temporal_address" >/dev/null 2>&1; do sleep 1; done
        TEMPORAL_ADDRESS="$temporal_address" npm run client -- "Say hello."
      '';
    };

    "temporal:health" = {
      description = "Check the local Temporal frontend";
      exec = ''
        temporal operator cluster health --address "''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}"
      '';
    };

    "temporal:namespaces" = {
      description = "List local Temporal namespaces";
      exec = ''
        temporal operator namespace list --address "''${TEMPORAL_ADDRESS:-127.0.0.1:''${TEMPORAL_PORT:-7233}}"
      '';
    };

  };

  enterShell = ''
    echo "inference-worker development environment"
    echo "  Temporal frontend: 127.0.0.1:7233"
    echo "  Temporal UI:       http://127.0.0.1:8233"
    echo "  Namespace:         inference"
    echo ""
    echo "Run 'devenv up' to start Temporal and the inference worker."
  '';
}
