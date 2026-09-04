{
  description = "Temporal worker for durable Pi and inference tasks";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = {self, nixpkgs}: let
    systems = ["aarch64-darwin" "x86_64-linux"];
    forAllSystems = nixpkgs.lib.genAttrs systems;
  in {
    packages = forAllSystems (system: let
      pkgs = import nixpkgs {inherit system;};
    in {
      inference-worker = pkgs.buildNpmPackage {
        pname = "inference-worker";
        version = "0.1.0";
        src = nixpkgs.lib.cleanSource ./.;
        npmDepsFetcherVersion = 2;
        npmDepsHash = "sha256-K1M/wvQLUTTj9GnmLYnc4Rz5hgS6EamincNjHYN466s=";
        npmBuildScript = "build";
        nativeBuildInputs = [pkgs.makeWrapper];

        installPhase = ''
          runHook preInstall
          mkdir -p "$out/lib/inference-worker" "$out/bin"
          cp -r dist node_modules package.json "$out/lib/inference-worker/"
          makeWrapper "${pkgs.nodejs}/bin/node" "$out/bin/inference-worker" \
            --add-flags "$out/lib/inference-worker/dist/worker.js"
          makeWrapper "${pkgs.nodejs}/bin/node" "$out/bin/inference-worker-client" \
            --add-flags "$out/lib/inference-worker/dist/client.js"
          runHook postInstall
        '';
      };
      default = self.packages.${system}.inference-worker;
    });

    apps = forAllSystems (system: {
      inference-worker = {
        type = "app";
        program = "${self.packages.${system}.inference-worker}/bin/inference-worker";
      };
      default = self.apps.${system}.inference-worker;
    });

    darwinModules.inference-worker = {config, lib, pkgs, ...}:
      import ./nix/module.nix {
        inherit config lib pkgs;
        package = self.packages.${pkgs.system}.inference-worker;
      };
  };
}
