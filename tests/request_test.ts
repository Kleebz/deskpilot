import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  BodyReadTimeout,
  BodyTooLarge,
  boundedJson,
} from "../server/request.ts";

Deno.test("boundedJson rejects a truthful oversized content length before reading", async () => {
  const req = new Request("http://local/", {
    method: "POST",
    headers: { "content-length": "100" },
    body: "{}",
  });
  await assertRejects(() => boundedJson(req, 10), BodyTooLarge);
});

Deno.test("boundedJson limits streamed bytes without trusting content length", async () => {
  const req = new Request("http://local/", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    }),
  });
  await assertRejects(() => boundedJson(req, 10), BodyTooLarge);
});

Deno.test("boundedJson parses bounded JSON and maps malformed JSON to null", async () => {
  assertEquals(
    await boundedJson(
      new Request("http://local/", { method: "POST", body: '{"ok":true}' }),
      64,
    ),
    { ok: true },
  );
  assertEquals(
    await boundedJson(
      new Request("http://local/", { method: "POST", body: "{" }),
      64,
    ),
    null,
  );
});

Deno.test("boundedJson times out a body that never finishes", async () => {
  const req = new Request("http://local/", {
    method: "POST",
    body: new ReadableStream({ start() {} }),
  });
  await assertRejects(() => boundedJson(req, 64, 10), BodyReadTimeout);
});
