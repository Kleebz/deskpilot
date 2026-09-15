const DEC = new TextDecoder();

export class BodyTooLarge extends Error {
  constructor(public limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "BodyTooLarge";
  }
}

export class BodyReadTimeout extends Error {
  constructor(public timeoutMs: number) {
    super(`request body was not received within ${timeoutMs}ms`);
    this.name = "BodyReadTimeout";
  }
}

/** Read and parse JSON while enforcing the limit on bytes actually received. */
export async function boundedJson(
  req: Request,
  limit: number,
  timeoutMs = 10_000,
): Promise<any | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new BodyTooLarge(limit);
  }
  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new BodyReadTimeout(timeoutMs)),
      timeoutMs,
    );
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel("body too large").catch(() => {});
        throw new BodyTooLarge(limit);
      }
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel("body read stopped").catch(() => {});
    throw e;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(DEC.decode(bytes));
  } catch {
    return null;
  }
}
