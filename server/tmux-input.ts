// tmux input primitives shared by the HTTP boundary and its tests.
//
// A distinct buffer per request is important: load-buffer and paste-buffer are
// separate tmux calls, so a fixed name lets two simultaneous requests replace
// each other's text between those calls.
export function inputBufferName(id: string = crypto.randomUUID()): string {
  return `deskpilot-${id.replaceAll("-", "")}`;
}

// Keep paste and the optional Enter in one tmux command sequence. Interactive
// applications that enable bracketed paste see the entire composed line as a
// paste before Enter arrives, rather than seeing Enter race literal key events.
export function pasteInputArgs(
  buffer: string,
  session: string,
  enter: boolean,
): string[] {
  const args = ["paste-buffer", "-p", "-d", "-b", buffer, "-t", session];
  if (enter) args.push(";", "send-keys", "-t", session, "Enter");
  return args;
}
