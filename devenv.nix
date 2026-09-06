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

in {
  packages = [
    pkgs.nodejs
    pkgs.temporal-cli
    tempo
  ];

  services.temporal = {
    enable = true;
    ip = "127.0.0.1";
    port = 7233;
    namespaces = ["inference"];

    state.ephemeral = false;

    ui = {
      enable = true;
      ip = "127.0.0.1";
      port = 8233;
    };
  };

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
        temporal operator cluster health --address "''${INTEGRATION_TEMPORAL_ADDRESS:-127.0.0.1:7233}" && \
        npm run build && \
        npm run test:integration
      '';
    };

    "integration:worker-shaves-yak" = {
      description = "Start the worker and verify it dispatches and completes a temporary yx yak";
      exec = ''
        temporal operator cluster health --address "''${INTEGRATION_TEMPORAL_ADDRESS:-127.0.0.1:7233}" && \
        npm run build && \
        npm run test:worker-integration
      '';
    };

    "worker:start" = {
      description = "Start the Temporal worker";
      exec = "npm start";
    };

    "worker:start:dev" = {
      description = "Start the Temporal worker from TypeScript source";
      exec = "npm run dev";
    };

    "worker:client" = {
      description = "Submit a test inference workflow";
      exec = "npm run client -- \"Say hello.\"";
    };

    "temporal:health" = {
      description = "Check the local Temporal frontend";
      exec = ''
        temporal operator cluster health --address 127.0.0.1:7233
      '';
    };

    "temporal:namespaces" = {
      description = "List local Temporal namespaces";
      exec = ''
        temporal operator namespace list --address 127.0.0.1:7233
      '';
    };
  };

  enterShell = ''
    echo "inference-worker development environment"
    echo "  Temporal frontend: 127.0.0.1:7233"
    echo "  Temporal UI:       http://127.0.0.1:8233"
    echo "  Namespace:         inference"
    echo ""
    echo "Run 'devenv up' to start Temporal."
  '';
}
