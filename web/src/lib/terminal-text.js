// Exclude padding where a wide character moved to the next row, preserving
// actual space characters inside wrapped text.
export function terminalText(buf) {
  if (!buf) return "";
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    let end = line.length;
    while (end > 0) {
      const cell = line.getCell(end - 1);
      if (!cell || cell.getWidth() !== 1 || cell.getChars() !== "") break;
      end--;
    }
    const s = line.translateToString(false, 0, end);
    if (line.isWrapped && out.length) out[out.length - 1] += s;
    else out.push(s);
  }
  // Trim after joining: the final wrapped row may itself be empty.
  const lines = out.map((s) => s.trimEnd());
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
