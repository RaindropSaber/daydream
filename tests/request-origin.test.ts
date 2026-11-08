import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequestOrigin } from "../src/lib/server/request-origin";

test("local requests use the actual Host while rejecting cross-origin and untrusted hosts", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
    assert.doesNotThrow(() =>
      checkRequestOrigin(
        new Headers({ host, origin: `http://${host}` }),
        "http:",
      ),
    );
  }
  assert.doesNotThrow(() =>
    checkRequestOrigin(new Headers({ host: "127.0.0.1:3000" }), "http:"),
  );
  for (const origin of [
    "http://localhost:3000",
    "http://127.0.0.1:4000",
    "https://127.0.0.1:3000",
    "https://foreign.test",
    "null",
  ]) {
    assert.throws(
      () =>
        checkRequestOrigin(
          new Headers({ host: "127.0.0.1:3000", origin }),
          "http:",
        ),
      /跨站请求/,
    );
  }
  for (const host of [
    "foreign.test:3000",
    "127.0.0.1.foreign.test:3000",
    "127.0.0.1@foreign.test:3000",
    "localhost:3000/anything",
    "",
  ]) {
    assert.throws(
      () => checkRequestOrigin(new Headers({ host }), "http:"),
      /主机地址/,
    );
  }
});
