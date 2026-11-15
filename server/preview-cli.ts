import {
  inspectPreview,
  PREVIEW_MAX_BYTES,
  previewLabels,
} from "./previews.ts";
import { sessionBase } from "./run.ts";

export function previewArgs(args: string[]) {
  let file = "", task = "", caption = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--task", "--session", "--caption"].includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`missing value for ${arg}`);
      }
      if (arg === "--caption") caption = value;
      else task = value;
    } else if (arg === "--") {
      if (file || i + 2 !== args.length) {
        throw new Error("provide one image file");
      }
      file = args[++i];
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else if (file) throw new Error("provide one image file");
    else file = arg;
  }
  if (!file) {
    throw new Error(
      "usage: deskpilot preview IMAGE [--task NAME] [--caption TEXT]",
    );
  }
  return { file, task, caption };
}

export function previewPort(config: string, override?: string): string {
  let port = override;
  if (port === undefined) {
    const line = config.split(/\r?\n/).filter((l) =>
      /^\s*DESKPILOT_PORT\s*=/.test(l)
    ).at(-1);
    const value = line?.match(
      /^\s*DESKPILOT_PORT\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*(?:#.*)?$/,
    );
    if (line && !value) throw new Error("DESKPILOT_PORT must be a port number");
    port = value?.slice(1).find((v) => v !== undefined) || "8790";
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("invalid DESKPILOT_PORT");
  }
  return port;
}

export async function publishPreview(args: string[]): Promise<number> {
  try {
    const options = previewArgs(args);
    let task = options.task;
    if (!task && Deno.env.get("TMUX")) {
      try {
        const result = await new Deno.Command("tmux", {
          args: [
            "display-message",
            "-p",
            ...(Deno.env.get("TMUX_PANE")
              ? ["-t", Deno.env.get("TMUX_PANE")!]
              : []),
            "#{session_name}",
          ],
          stdout: "piped",
          stderr: "null",
        }).output();
        if (result.success) {
          task = new TextDecoder().decode(result.stdout).trim();
        }
      } catch { /* ordinary project-based previews need no tmux */ }
    }
    task ||= sessionBase(Deno.cwd()).slice(0, 96);
    const caption = options.caption || options.file.split("/").at(-1) ||
      "Preview";
    previewLabels(task, caption);
    const stat = await Deno.stat(options.file);
    if (!stat.isFile) throw new Error("preview must be a regular image file");
    if (stat.size > PREVIEW_MAX_BYTES) throw new Error("image exceeds 8 MiB");
    const data = await Deno.readFile(options.file);
    const image = inspectPreview(data);
    const home = Deno.env.get("HOME") || "";
    const tokenFile = Deno.env.get("DESKPILOT_TOKEN_FILE") ||
      `${home}/.local/state/deskpilot/local-token`;
    const token = (await Deno.readTextFile(tokenFile)).trim();
    let config = "";
    if (Deno.env.get("DESKPILOT_PORT") === undefined) {
      try {
        config = await Deno.readTextFile(
          Deno.env.get("DESKPILOT_CONFIG") ||
            `${home}/.config/deskpilot/config`,
        );
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    }
    const port = previewPort(config, Deno.env.get("DESKPILOT_PORT"));
    const query = new URLSearchParams({ task, caption });
    const response = await fetch(
      `http://127.0.0.1:${port}/api/previews?${query}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": image.mime,
        },
        body: data,
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "preview upload failed");
    console.log(
      `Published preview for ${body.task}: ${body.caption} (${body.width} × ${body.height})`,
    );
    console.log("Open Previews in Deskpilot on your phone.");
    return 0;
  } catch (e) {
    console.error(`preview: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) Deno.exit(await publishPreview(Deno.args));
