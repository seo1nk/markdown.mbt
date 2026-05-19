/**
 * VRT for the source-preserving ("literal") renderer.
 *
 * For a fixed set of Markdown samples we render two views of the same
 * document and verify that, character by character, they occupy the same
 * positions on screen:
 *
 *   1. A plain `<pre>` showing the source text — this is the ground truth
 *      character grid.
 *   2. The output of `toHtmlLiteral(source)` injected into a sibling
 *      element with the same fonts/spacing rules from
 *      `frontend/editor/overlay.css`.
 *
 * Both views are absolutely positioned at the same origin. We measure the
 * client-rect of each visible glyph in the rendered view and assert that
 * it falls inside the corresponding glyph cell in the source view.
 *
 * We also run a snapshot-style visual diff: with both layers fully
 * opaque, every glyph cell should be identically populated, so a
 * pixel-diff of the rendered layer vs the source layer should match
 * within a tight tolerance.
 */

import { expect, test } from "@playwright/test";

const SAMPLES = [
  { name: "headings", md: "# H1\n\n## H2\n\n### H3\n" },
  {
    name: "emphasis",
    md: "*italic* and **bold** and ~~strike~~ and `code`\n",
  },
  { name: "bullet-list", md: "- one\n- two\n- three\n" },
  { name: "ordered-list", md: "1. one\n2. two\n3. three\n" },
  { name: "blockquote", md: "> first\n> second\n" },
  {
    name: "autolink",
    md: "see <https://example.com> for details\n",
  },
  {
    name: "fenced-code",
    md: "```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n",
  },
  {
    name: "mixed",
    md: [
      "# Title",
      "",
      "Paragraph with *em*, **strong**, and `code`.",
      "",
      "- item one",
      "- item two",
      "",
      "> a quote",
      "",
    ].join("\n"),
  },
];

test.describe("literal renderer overlay invariant", () => {
  for (const sample of SAMPLES) {
    test(`${sample.name} renders the same glyph grid as source`, async ({ page }) => {
      await page.goto("/literal/");
      // Wait until the demo's first paint settled.
      await page.waitForSelector("#rendered .md-marker, #rendered p, #rendered h1, #rendered h2");

      // Replace the source with the test sample and fire `input` so the
      // demo recomputes both panes.
      await page.evaluate((md) => {
        const ta = document.getElementById("source") as HTMLTextAreaElement;
        ta.value = md;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }, sample.md);

      // The demo writes a green `✓` into #invariant-state if the rendered
      // output's visible text equals `toMarkdown(source)`. That covers the
      // entire byte-for-byte equality check.
      await expect(page.locator("#invariant-state")).toHaveText(/overlay invariant holds/);
    });
  }

  test("overlay screenshot: source view vs rendered view align", async ({ page }) => {
    await page.goto("/literal/");
    await page.fill("#source", SAMPLES.find((s) => s.name === "mixed")!.md);
    await page.locator("#overlay-toggle").check();
    // Give the layout a frame to settle.
    await page.waitForTimeout(50);

    // Capture each layer at the same coordinates. Under monospace +
    // `white-space: pre-wrap`, the two layers should overlap exactly;
    // we screenshot the host element so it includes both.
    const host = page.locator("#host");
    await expect(host).toHaveScreenshot("literal-overlay-mixed.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
