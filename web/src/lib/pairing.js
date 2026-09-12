// Turn the two useful phone handoffs into one shape. A person may have the
// eight-character code in front of them, or may have copied the complete link
// from `deskpilot pair --link`. The latter already contains the code and should
// never require them to split it into two fields by hand.
export function parsePairingInput(raw) {
  const value = raw.trim();
  if (!value) return { code: "" };

  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return { code: "", wasLink: true };
    const code = url.searchParams.get("code")?.trim() ?? "";
    return {
      code,
      host: { origin: url.origin, token: "", name: url.hostname },
      wasLink: true,
    };
  } catch {
    return { code: value, wasLink: false };
  }
}
