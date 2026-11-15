export function terminalIdentity(
  id: string,
  pid: string,
  started: string,
  created: string,
) {
  return /^\$\d+$/.test(id) && /^\d+$/.test(pid) && /^\d+$/.test(started) &&
      /^\d+$/.test(created)
    ? { terminalId: id, generation: `${pid}:${started}:${created}` }
    : null;
}
export const TERMINAL_IDENTITY_FORMAT =
  "#{session_id}\t#{pid}\t#{start_time}\t#{session_created}";
export async function terminalTarget(
  name: string,
  expected: any,
  run: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; out: string }>,
) {
  if (expected == null) return name;
  if (
    typeof expected.terminalId !== "string" ||
    typeof expected.generation !== "string"
  ) return null;
  const result = await run("tmux", [
    "display-message",
    "-p",
    "-t",
    `=${name}:`,
    TERMINAL_IDENTITY_FORMAT,
  ]);
  if (result.code) return null;
  const actual = terminalIdentity(
    ...result.out.trim().split("\t") as [string, string, string, string],
  );
  return actual && actual.terminalId === expected.terminalId &&
      actual.generation === expected.generation
    ? actual.terminalId
    : null;
}
