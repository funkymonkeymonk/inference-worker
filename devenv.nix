{pkgs, ...}: {
  packages = [pkgs.temporal-cli];

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
