import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/a11y/contrast";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!match?.[1]) throw new Error(`Missing colour token --color-${name}`);
  return match[1].toLowerCase();
}

describe("design tokens", () => {
  it("match the approved spec palette (§3)", () => {
    expect({
      primary: token("primary"),
      primaryDark: token("primary-dark"),
      ink: token("ink"),
      muted: token("muted"),
      surface: token("surface"),
      subtle: token("subtle"),
      border: token("border"),
    }).toEqual({
      primary: "#087f45",
      primaryDark: "#075b35",
      ink: "#172b20",
      muted: "#66756c",
      surface: "#ffffff",
      subtle: "#f3f8f4",
      border: "#dce5df",
    });
  });

  // [foreground, background] pairs used for text: WCAG 1.4.3 AA requires >= 4.5:1.
  const textPairs: [string, string][] = [
    ["ink", "surface"],
    ["ink", "subtle"],
    ["muted", "surface"],
    ["muted", "subtle"],
    ["primary", "surface"],
    ["primary", "subtle"],
    ["surface", "primary"],
    ["surface", "primary-dark"],
    ["danger", "surface"],
  ];

  it.each(textPairs)("text %s on %s meets 4.5:1", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  // Non-text UI (control outlines, focus ring, location dot): WCAG 1.4.11 requires >= 3:1.
  const uiPairs: [string, string][] = [
    ["border-strong", "surface"],
    ["border-strong", "subtle"],
    ["focus", "surface"],
    ["focus", "subtle"],
    ["user-location", "surface"],
    ["primary", "surface"],
  ];

  it.each(uiPairs)("UI %s against %s meets 3:1", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });
});
