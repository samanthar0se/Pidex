import assert from "node:assert/strict";
import test from "node:test";
import { randomUuid } from "../apps/client/src/client-identifier.js";

test("client UUID generation works when insecure HTTP omits crypto.randomUUID", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(7);
        return bytes;
      },
    },
  });

  try {
    assert.equal(randomUuid(), "07070707-0707-4707-8707-070707070707");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete (globalThis as { crypto?: Crypto }).crypto;
  }
});
