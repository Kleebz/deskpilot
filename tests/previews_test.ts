import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  inspectPreview,
  PREVIEW_MAX_BYTES,
  PreviewInputError,
  Previews,
  PreviewStoreError,
} from "../server/previews.ts";
import { previewArgs, previewPort } from "../server/preview-cli.ts";

export const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhV8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

Deno.test("image publishing honors the configured service port and an environment override", () => {
  assertEquals(previewPort(""), "8790");
  assertEquals(
    previewPort("# DESKPILOT_PORT=1111\nDESKPILOT_PORT='8899'\n"),
    "8899",
  );
  assertEquals(previewPort('DESKPILOT_PORT="8899"\n', "8900"), "8900");
  assertThrows(() => previewPort("DESKPILOT_PORT=not-a-port"));
  assertThrows(() => previewPort("", "65536"));
});

Deno.test("PNG and JPEG dimensions come from image bytes rather than filename or headers", () => {
  assertEquals(inspectPreview(png), { mime: "image/png", width: 1, height: 1 });
  const jpeg = new Uint8Array([
    255,
    216,
    255,
    192,
    0,
    8,
    8,
    0,
    7,
    0,
    9,
    0,
    255,
    217,
  ]);
  assertEquals(inspectPreview(jpeg), {
    mime: "image/jpeg",
    width: 9,
    height: 7,
  });
  assertThrows(
    () =>
      inspectPreview(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),
    PreviewInputError,
  );
  const huge = png.slice();
  new DataView(huge.buffer).setUint32(16, 10_000);
  assertThrows(() => inspectPreview(huge), PreviewInputError);
  assertThrows(
    () => inspectPreview(new Uint8Array(PREVIEW_MAX_BYTES + 1)),
    PreviewInputError,
  );
});

Deno.test("preview history persists without any terminal session and retains only its bounded recent images", async () => {
  const directory = await Deno.makeTempDir({ prefix: "deskpilot-previews-" });
  try {
    const store = new Previews(directory, 3);
    const first = store.add(png, "Website", "Initial view");
    assertEquals(store.read(first.id)?.data, png);
    const second = store.add(png, "CAD fixture", "Mount render");
    const third = store.add(png, "Website", "Layout adjusted");
    const fourth = store.add(png, "Website", "Latest view");
    const restarted = new Previews(directory, 3);
    assertEquals(restarted.list().map((p) => p.id), [
      fourth.id,
      third.id,
      second.id,
    ]);
    assertEquals(restarted.read(first.id), null);
    assertEquals([...Deno.readDirSync(directory)].length, 6);
    assertEquals(
      Deno.statSync(`${directory}/${fourth.id}.image`).mode! & 0o777,
      0o600,
    );
    assert(restarted.remove(third.id));
    assertEquals(restarted.read(third.id), null);
    assertEquals(restarted.remove(third.id), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("bad images and invalid metadata do not replace existing previews or allow path traversal", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new Previews(directory);
    const original = store.add(png, "Task", "Valid image");
    assertThrows(() => store.add(png, "", "caption"), PreviewInputError);
    assertThrows(
      () => store.add(png, "Task", "x".repeat(1001)),
      PreviewInputError,
    );
    assertThrows(
      () => store.add(new Uint8Array(), "Task", "Invalid image"),
      PreviewInputError,
    );
    assertEquals(store.list(), [original]);
    assertEquals(store.read("../token"), null);
    assertEquals(store.remove("../../token"), false);
    assertEquals(store.read(original.id)?.data, png);
    await Deno.writeTextFile(`${directory}/${original.id}.json`, "corrupt");
    assertThrows(() => store.list(), PreviewStoreError);
    assertThrows(
      () => store.add(png, "Task", "Must not reset history"),
      PreviewStoreError,
    );
    assertEquals([...Deno.readDirSync(directory)].length, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("preview command parses task labels and literal paths without a shell command", () => {
  assertEquals(
    previewArgs([
      "my screenshot.png",
      "--task",
      "Login page",
      "--caption",
      "Layout review",
    ]),
    {
      file: "my screenshot.png",
      task: "Login page",
      caption: "Layout review",
    },
  );
  assertEquals(
    previewArgs(["--session", "api", "--", "-image.png"]).task,
    "api",
  );
  assertThrows(() => previewArgs([]));
  assertThrows(() => previewArgs(["image.png", "other.png"]));
  assertThrows(() => previewArgs(["image.png", "--caption"]));
  assertThrows(() => previewArgs(["image.png", "--unknown"]));
});
