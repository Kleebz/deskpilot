import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { parsePairingInput } from "../web/src/lib/pairing.js";

Deno.test("a complete pairing link supplies its embedded code and host", () => {
  assertEquals(
    parsePairingInput("https://desk.example.test/?code=C9R6DVFQ"),
    {
      code: "C9R6DVFQ",
      host: {
        origin: "https://desk.example.test",
        token: "",
        name: "desk.example.test",
      },
      wasLink: true,
    },
  );
});

Deno.test("a bare pairing code remains valid input", () => {
  assertEquals(parsePairingInput("  C9R6DVFQ  "), {
    code: "C9R6DVFQ",
    wasLink: false,
  });
});

Deno.test("a link without a pairing code does not become a token", () => {
  assertEquals(parsePairingInput("https://desk.example.test/"), {
    code: "",
    host: {
      origin: "https://desk.example.test",
      token: "",
      name: "desk.example.test",
    },
    wasLink: true,
  });
});
