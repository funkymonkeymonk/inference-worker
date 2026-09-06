import assert from "node:assert/strict";
import test from "node:test";
import { temporalAddressFromEnvironment } from "./temporal-address.js";

test("uses devenv's allocated Temporal port when no address is explicit", () => {
  assert.equal(temporalAddressFromEnvironment({ TEMPORAL_PORT: "7234" }), "127.0.0.1:7234");
});

test("prefers an explicit Temporal address", () => {
  assert.equal(
    temporalAddressFromEnvironment({ TEMPORAL_ADDRESS: "temporal.example:7233", TEMPORAL_PORT: "7234" }),
    "temporal.example:7233",
  );
});
