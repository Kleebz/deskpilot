import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert@1";
import { Devices } from "../server/devices.ts";
import { ensureLocalDevice } from "../server/local-device.ts";

Deno.test("desktop helpers enroll once and retain a revocable identity across restart", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const devices = new Devices(`${dir}/devices.json`);
    const device = await ensureLocalDevice(devices, `${dir}/local-token`);
    const token = (await Deno.readTextFile(`${dir}/local-token`)).trim();
    assertEquals((await devices.match(token))?.id, device.id);
    assert(!(await Deno.readTextFile(`${dir}/devices.json`)).includes(token));
    const restored = new Devices(`${dir}/devices.json`);
    assertEquals(
      (await ensureLocalDevice(restored, `${dir}/local-token`)).id,
      device.id,
    );
    assertEquals(restored.list.length, 1);
    assertEquals((await Deno.stat(`${dir}/local-token`)).mode! & 0o777, 0o600);
    assert(restored.revoke(device.id));
    assertEquals(await restored.match(token), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a token file alone never authorizes access and never replaces a phone credential", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const devices = new Devices(`${dir}/devices.json`);
    const phone = (await devices.enroll(devices.newCode(), "Phone"))!;
    const shared = "a".repeat(64);
    await Deno.writeTextFile(`${dir}/local-token`, shared);
    const local = await ensureLocalDevice(devices, `${dir}/local-token`);
    const token = (await Deno.readTextFile(`${dir}/local-token`)).trim();
    assertNotEquals(token, shared);
    assertEquals(await devices.match(shared), null);
    assertEquals((await devices.match(token))?.id, local.id);
    assertEquals((await devices.match(phone.token))?.id, phone.device.id);
    const after = new Devices(`${dir}/devices.json`);
    assertEquals(after.list.length, 2);
    assertEquals((await after.match(phone.token))?.id, phone.device.id);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a revoked desktop helper token stays revoked when its local owner starts again", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const devices = new Devices(`${dir}/devices.json`);
    const first = await ensureLocalDevice(devices, `${dir}/local-token`);
    const old = (await Deno.readTextFile(`${dir}/local-token`)).trim();
    devices.revoke(first.id);
    const next = await ensureLocalDevice(devices, `${dir}/local-token`);
    assertNotEquals(next.id, first.id);
    assertEquals(await devices.match(old), null);
    assertEquals(devices.list.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("desktop credential read errors fail closed without creating a replacement identity", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const devices = new Devices(`${dir}/devices.json`);
    await Deno.mkdir(`${dir}/local-token`);
    await assertRejects(() => ensureLocalDevice(devices, `${dir}/local-token`));
    assertEquals(devices.list.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
