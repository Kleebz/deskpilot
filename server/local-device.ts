// Desktop helpers use an ordinary registered device credential. The credential
// file is never a second authentication authority and is never a pairing link.
import { Devices } from "./devices.ts";

export async function ensureLocalDevice(devices: Devices, path: string) {
  try {
    const token = (await Deno.readTextFile(path)).trim();
    const device = await devices.match(token);
    if (device) {
      await Deno.chmod(path, 0o600);
      return device;
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) || "/" : ".";
  await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  // Establish that the destination is writable before registering an identity.
  const temp = await Deno.makeTempFile({ dir, prefix: ".local-token." });
  let made: Awaited<ReturnType<Devices["enroll"]>> = null;
  let committed = false;
  try {
    await Deno.chmod(temp, 0o600);
    made = await devices.enroll(devices.newCode(), "Desktop helpers (local)");
    if (!made) throw new Error("could not register desktop helpers");
    const file = await Deno.open(temp, { write: true, truncate: true });
    try {
      const bytes = new TextEncoder().encode(made.token + "\n");
      let offset = 0;
      while (offset < bytes.length) {
        const written = await file.write(bytes.subarray(offset));
        if (!written) {
          throw new Error("could not write desktop helper credential");
        }
        offset += written;
      }
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.rename(temp, path);
    committed = true;
    const parent = await Deno.open(dir, { read: true });
    try {
      await parent.sync();
    } finally {
      parent.close();
    }
    return made.device;
  } catch (e) {
    await Deno.remove(temp).catch(() => {});
    if (made && !committed) devices.revoke(made.device.id);
    // A completed rename remains a valid file/store pair even if the final
    // directory sync fails. Fail startup without invalidating that written key.
    throw e;
  }
}
