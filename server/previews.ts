// Published task images are independent of terminal transport and compositor
// state. Only explicitly uploaded bytes are served; no project path is exposed.
export const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const PREVIEW_MAX_ITEMS = 20;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Preview = {
  id: string;
  task: string;
  caption: string;
  created: number;
  mime: "image/png" | "image/jpeg";
  bytes: number;
  width: number;
  height: number;
};

export class PreviewInputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
export class PreviewStoreError extends Error {}

export function previewLabels(task: unknown, caption: unknown) {
  if (
    typeof task !== "string" || !task.trim() || task.length > 96 ||
    /[\x00-\x1f\x7f]/.test(task)
  ) {
    throw new PreviewInputError("task must contain 1–96 printable characters");
  }
  if (
    typeof caption !== "string" || caption.length > 1000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(caption)
  ) {
    throw new PreviewInputError("caption must contain at most 1000 characters");
  }
  return { task: task.trim(), caption: caption.trim() };
}

export function inspectPreview(data: Uint8Array) {
  if (data.length > PREVIEW_MAX_BYTES) {
    throw new PreviewInputError("image exceeds 8 MiB", 413);
  }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let width = 0, height = 0, mime: Preview["mime"];
  if (
    data.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => data[i] === b) &&
    v.getUint32(8) === 13 && v.getUint32(12) === 0x49484452
  ) {
    mime = "image/png";
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (
    data.length >= 4 && data[0] === 255 && data[1] === 216 &&
    data.at(-2) === 255 && data.at(-1) === 217
  ) {
    mime = "image/jpeg";
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 255) break;
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 218 || marker === 217) break;
      if (offset + 2 > data.length) break;
      const size = v.getUint16(offset);
      if (size < 2 || offset + size > data.length) break;
      if (
        marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) &&
        size >= 8
      ) {
        height = v.getUint16(offset + 3);
        width = v.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  } else throw new PreviewInputError("publish a PNG or JPEG image", 415);
  if (
    !width || !height || width > 8192 || height > 8192 ||
    width * height > 32_000_000
  ) {
    throw new PreviewInputError(
      "image must have valid dimensions, up to 8192 per side and 32 megapixels",
      415,
    );
  }
  return { mime, width, height };
}

export class Previews {
  constructor(private directory: string, private keep = PREVIEW_MAX_ITEMS) {}

  list(): Preview[] {
    try {
      let entries: Deno.DirEntry[];
      try {
        entries = [...Deno.readDirSync(this.directory)];
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return [];
        throw e;
      }
      return entries.filter((e) =>
        e.isFile && e.name.endsWith(".json") && ID.test(e.name.slice(0, -5))
      ).map((e) => {
        const p = JSON.parse(
          Deno.readTextFileSync(`${this.directory}/${e.name}`),
        ) as Preview;
        previewLabels(p.task, p.caption);
        if (
          p.id !== e.name.slice(0, -5) || !Number.isFinite(p.created) ||
          !Number.isInteger(p.bytes) ||
          p.bytes <= 0 || p.bytes > PREVIEW_MAX_BYTES ||
          !["image/png", "image/jpeg"].includes(p.mime) ||
          !Number.isInteger(p.width) || !Number.isInteger(p.height) ||
          p.width <= 0 || p.height <= 0 ||
          p.width > 8192 || p.height > 8192 || p.width * p.height > 32_000_000
        ) throw new Error("invalid preview metadata");
        return p;
      }).sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
    } catch (e) {
      throw new PreviewStoreError(`could not read previews: ${e}`);
    }
  }

  add(data: Uint8Array, task: string, caption: string): Preview {
    const labels = previewLabels(task, caption);
    const image = inspectPreview(data);
    const previous = this.list();
    const p: Preview = {
      id: crypto.randomUUID(),
      ...labels,
      ...image,
      bytes: data.length,
      created: Math.max(Date.now(), (previous[0]?.created ?? 0) + 1),
    };
    let temporary = "", metadata = "";
    try {
      Deno.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      temporary = Deno.makeTempFileSync({
        dir: this.directory,
        prefix: ".image-",
      });
      Deno.writeFileSync(temporary, data, { mode: 0o600 });
      metadata = Deno.makeTempFileSync({
        dir: this.directory,
        prefix: ".metadata-",
      });
      Deno.writeTextFileSync(metadata, JSON.stringify(p), { mode: 0o600 });
      Deno.renameSync(temporary, `${this.directory}/${p.id}.image`);
      temporary = "";
      // Metadata is the commit marker: readers never see a half-written image.
      Deno.renameSync(metadata, `${this.directory}/${p.id}.json`);
      metadata = "";
    } catch (e) {
      for (
        const path of [temporary, metadata, `${this.directory}/${p.id}.image`]
      ) {
        if (path) {
          try {
            Deno.removeSync(path);
          } catch { /* not committed */ }
        }
      }
      throw new PreviewStoreError(`could not publish preview: ${e}`);
    }
    for (const old of previous.slice(this.keep - 1)) this.remove(old.id);
    return p;
  }

  read(id: string): { preview: Preview; data: Uint8Array<ArrayBuffer> } | null {
    if (!ID.test(id)) return null;
    const preview = this.list().find((p) => p.id === id);
    if (!preview) return null;
    try {
      return {
        preview,
        data: Deno.readFileSync(`${this.directory}/${id}.image`),
      };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return null;
      throw new PreviewStoreError(`could not read preview image: ${e}`);
    }
  }

  remove(id: string): boolean {
    if (!ID.test(id)) return false;
    let removed = false;
    for (const suffix of ["json", "image"]) {
      try {
        Deno.removeSync(`${this.directory}/${id}.${suffix}`);
        removed = true;
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) {
          throw new PreviewStoreError(`could not remove preview: ${e}`);
        }
      }
    }
    return removed;
  }
}
