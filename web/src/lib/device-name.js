// Browser labels are hints for a person deciding which credential to revoke.
// Chromium deliberately reduces Android's user agent to a generic "K", so ask
// Client Hints for the model when available and otherwise use an honest family
// name. Safari does not expose Client Hints, but its UA still identifies the
// iPhone/iPad family.
/**
 * @param {{
 *   userAgent?: string,
 *   userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{model?: string, platform?: string}> }
 * }} nav
 */
export async function deviceName(nav = navigator) {
  const hints = nav.userAgentData;
  if (hints?.getHighEntropyValues) {
    try {
      const { model, platform } = await hints.getHighEntropyValues([
        "model",
        "platform",
      ]);
      const clean = String(model ?? "").trim();
      if (clean && clean !== "K" && clean.length <= 40) return clean;
      if (platform === "Android") return "Android phone";
    } catch { /* privacy settings may decline high-entropy hints */ }
  }

  const ua = String(nav.userAgent ?? "");
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) {
    const model = ua.match(/Android [^;)]*;\s*([^;)]+)/i)?.[1]?.replace(
      /\s+Build\/.*/,
      "",
    ).trim();
    if (model && model !== "K" && model.length <= 40) return model;
    return "Android phone";
  }
  return "browser";
}
