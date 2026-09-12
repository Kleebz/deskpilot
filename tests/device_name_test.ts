import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { deviceName } from "../web/src/lib/device-name.js";

Deno.test("reduced Android K becomes a useful generic label", async () => {
  assertEquals(
    await deviceName({
      userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36",
    }),
    "Android phone",
  );
});

Deno.test("Android Client Hints supplies the model when available", async () => {
  assertEquals(
    await deviceName({
      userAgent: "Mozilla/5.0 (Linux; Android 10; K)",
      userAgentData: {
        getHighEntropyValues: () =>
          Promise.resolve({ model: "Pixel 9", platform: "Android" }),
      },
    }),
    "Pixel 9",
  );
});

Deno.test("Safari devices get family labels", async () => {
  assertEquals(
    await deviceName({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    }),
    "iPhone",
  );
  assertEquals(
    await deviceName({
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    }),
    "iPad",
  );
});
