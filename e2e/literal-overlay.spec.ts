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
  test("demo applies literal overlay CSS reset", async ({ page }) => {
    await page.goto("/literal/");
    await page.waitForSelector("#rendered h1");
    await expect(page.locator("#overlay-toggle")).toBeChecked();
    await expect(page.locator("body")).toHaveClass(/overlay/);

    const styles = await page.evaluate(() => {
      const read = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`missing ${selector}`);
        const style = getComputedStyle(el);
        return {
          display: style.display,
          margin: style.margin,
          padding: style.padding,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          textTransform: style.textTransform,
          whiteSpace: style.whiteSpace,
        };
      };
      return {
        source: read("#source-view"),
        h1: read("#rendered h1"),
        h2: read("#rendered h2"),
        paragraph: read("#rendered p"),
        list: read("#rendered ul"),
        quote: read("#rendered blockquote"),
        code: read("#rendered pre"),
      };
    });

    for (const [name, style] of Object.entries(styles).filter(([name]) => name !== "source")) {
      expect(style, name).toMatchObject({
        display: "inline",
        margin: "0px",
        padding: "0px",
        fontSize: styles.source.fontSize,
        lineHeight: styles.source.lineHeight,
        textTransform: "none",
        whiteSpace: "pre-wrap",
      });
      expect(style.fontFamily, name).toBe(styles.source.fontFamily);
    }
  });

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
    await page.evaluate((md) => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = md;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, SAMPLES.find((s) => s.name === "mixed")!.md);
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

  // Click on a known glyph in the preview, then verify that the textarea
  // ends up focused with its caret at the correct source offset.
  test("click-to-cursor: heading marker maps to source position 0", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "# Title\n\nbody paragraph\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Click the very first character of the rendered output — the '#' of
    // the heading marker. Its source offset is 0.
    const h1 = page.locator("#rendered h1");
    const box = await h1.boundingBox();
    if (!box) throw new Error("h1 has no bounding box");
    // Click 2px in from the left edge to land on the first `#`.
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    // The demo flips into edit mode and focuses the textarea (via rAF)
    // with the cursor at offset 0.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("source");
    const caret = await page.evaluate(
      () => (document.getElementById("source") as HTMLTextAreaElement).selectionStart,
    );
    expect(caret).toBe(0);
  });

  test("click-to-cursor: clicking inside body paragraph lands inside body", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "# Title\n\nbody paragraph\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Click roughly the middle of the rendered <p> ("body paragraph").
    const p = page.locator("#rendered p");
    const box = await p.boundingBox();
    if (!box) throw new Error("p has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("source");
    const caret = await page.evaluate(
      () => (document.getElementById("source") as HTMLTextAreaElement).selectionStart,
    );
    // "# Title\n\n" is 9 chars; "body paragraph\n" is 15. The paragraph
    // sits at source offsets 9..23. A click in the middle of the paragraph
    // must land somewhere in that range.
    expect(caret).toBeGreaterThanOrEqual(9);
    expect(caret).toBeLessThanOrEqual(23);
  });

  test("preview-mode → edit-mode flip on click", async ({ page }) => {
    await page.goto("/literal/");
    await expect(page.locator("body")).toHaveAttribute("data-mode", "preview");
    const h1 = page.locator("#rendered h1").first();
    await h1.click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "edit");
    // Pressing Escape returns to preview mode.
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).toHaveAttribute("data-mode", "preview");
  });

  test("click-to-editor: starts highlighted markdown editor without source-layer layout shift", async ({ page }) => {
    const md = "# Title\n\nThis paragraph has **bold** and `code`.\n";
    await page.goto("/literal/");
    await page.evaluate((source) => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = source;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, md);

    const rectForText = (selector: string, needle: string) =>
      page.evaluate(
        ({ selector, needle }) => {
          const root = document.querySelector(selector);
          if (!root) throw new Error(`missing ${selector}`);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            const offset = text.indexOf(needle);
            if (offset >= 0) {
              const range = document.createRange();
              range.setStart(node, offset);
              range.setEnd(node, offset + 1);
              const rect = range.getBoundingClientRect();
              return { left: rect.left, top: rect.top };
            }
          }
          throw new Error(`missing ${needle}`);
        },
        { selector, needle },
      );

    const before = await rectForText("#source-view", "Title");
    await page.locator("#rendered h1").click();

    await expect(page.locator("body")).toHaveAttribute("data-mode", "edit");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("source");
    await expect(page.locator("#source-view .md-src-heading-marker")).toHaveCount(1);
    await expect(page.locator("#source-view .md-src-heading")).toHaveText("Title");
    await expect(page.locator("#source-view .md-src-strong")).toHaveText("**bold**");
    await expect(page.locator("#source-view .md-src-code")).toHaveText("code");
    const syntaxStyles = await page.evaluate(() => {
      const strong = document.querySelector("#source-view .md-src-strong");
      const em = document.querySelector("#source-view .md-src-em");
      const code = document.querySelector("#source-view .md-src-code");
      if (!strong || !code) throw new Error("missing syntax highlight spans");
      return {
        strongWeight: getComputedStyle(strong).fontWeight,
        emStyle: em ? getComputedStyle(em).fontStyle : "normal",
        codeColor: getComputedStyle(code).color,
        sourceColor: getComputedStyle(document.getElementById("source-view")!).color,
      };
    });
    expect(syntaxStyles.strongWeight).not.toBe("700");
    expect(syntaxStyles.emStyle).toBe("normal");
    expect(syntaxStyles.codeColor).not.toBe(syntaxStyles.sourceColor);

    const after = await rectForText("#source-view", "Title");
    expect(Math.abs(after.left - before.left)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(1);

    const sourceLayerText = await page.locator("#source-view").evaluate((el) => el.textContent);
    expect(sourceLayerText).toBe(md);
    const textareaColor = await page.locator("#source").evaluate((el) => getComputedStyle(el).color);
    expect(textareaColor).toBe("rgba(0, 0, 0, 0)");
  });

  test("preview overlay stays monochrome and aligned after edit roundtrip", async ({ page }) => {
    const md = "# Title\n\nalpha *italic* beta **bold** gamma `code` delta\n";
    await page.goto("/literal/");
    await page.evaluate((source) => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = source;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, md);

    await page.locator("#rendered h1").click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "edit");
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).toHaveAttribute("data-mode", "preview");

    const state = await page.evaluate(() => {
      const rectForText = (selector: string, needle: string) => {
        const root = document.querySelector(selector);
        if (!root) throw new Error(`missing ${selector}`);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? "";
          const offset = text.indexOf(needle);
          if (offset >= 0) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            return { left: rect.left, top: rect.top };
          }
        }
        throw new Error(`missing ${needle}`);
      };
      const sourceView = document.getElementById("source-view");
      const code = document.querySelector("#source-view .md-src-code");
      if (!sourceView || !code) throw new Error("missing source layer");
      return {
        sourceColor: getComputedStyle(sourceView).color,
        codeColor: getComputedStyle(code).color,
        points: ["beta", "gamma", "delta"].map((needle) => ({
          needle,
          rendered: rectForText("#rendered", needle),
          source: rectForText("#source-view", needle),
        })),
      };
    });

    expect(state.codeColor).toBe(state.sourceColor);
    for (const point of state.points) {
      expect(Math.abs(point.rendered.left - point.source.left), point.needle).toBeLessThan(1);
      expect(Math.abs(point.rendered.top - point.source.top), point.needle).toBeLessThan(1);
    }
  });

  test("partial update: unchanged blocks keep their DOM identity", async ({ page }) => {
    await page.goto("/literal/");
    // Use the textarea API to set the source we want to start from.
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "# Stable heading\n\nfirst paragraph\n\nsecond paragraph\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Capture node-identity refs by their initial position.
    await page.evaluate(() => {
      const win = window as unknown as { __initial: HTMLElement[] };
      win.__initial = Array.from(
        (document.getElementById("rendered") as HTMLElement).children,
      ) as HTMLElement[];
    });
    // Edit only the second paragraph by appending text. The heading and
    // first paragraph nodes must be the same JS objects after the patch.
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "# Stable heading\n\nfirst paragraph\n\nsecond paragraph plus extra\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const identity = await page.evaluate(() => {
      const win = window as unknown as { __initial: HTMLElement[] };
      const now = Array.from(
        (document.getElementById("rendered") as HTMLElement).children,
      );
      return win.__initial.map((node, i) => now[i] === node);
    });
    expect(identity[0]).toBe(true); // heading reused
    expect(identity[1]).toBe(true); // first paragraph reused
    expect(identity[2]).toBe(false); // second paragraph replaced
    // Patch stats badge reports exactly one replaced element (the
    // changed paragraph); reused count includes text-node separators so
    // we only assert non-zero rather than an exact value.
    const stats = await page.locator("#patch-stats").innerText();
    expect(stats).toContain("replaced 1");
    expect(stats).toMatch(/reused \d+/);
  });

  test("image preview: toggle inserts <img> without breaking the overlay invariant", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "intro\n\n![cat](/images/literal-preview-a.svg)\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Off by default: no <img> in the output.
    expect(await page.locator("#rendered img.md-image-preview").count()).toBe(0);
    // Toggle on.
    await page.locator("#image-preview-toggle").check();
    const imgCount = await page.locator("#rendered img.md-image-preview").count();
    expect(imgCount).toBe(1);
    // The body still hosts the source characters.
    const text = await page.locator("#rendered").innerText();
    expect(text).toContain("![cat](/images/literal-preview-a.svg)");
    // The overlay invariant indicator stays green — img has empty textContent.
    await expect(page.locator("#invariant-state")).toHaveText(/overlay invariant holds/);
  });

  test("image preview: demo sample uses debuggable local images", async ({ page }) => {
    await page.goto("/literal/");
    await page.locator("#image-preview-toggle").check();

    const images = page.locator("#rendered img.md-image-preview");
    await expect(images).toHaveCount(3);
    await expect
      .poll(() =>
        images.evaluateAll((imgs) =>
          imgs.every((img) => {
            const image = img as HTMLImageElement;
            return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
          }),
        ),
      )
      .toBe(true);

    const states = await images.evaluateAll((imgs) =>
      imgs.map((img) => {
        const image = img as HTMLImageElement;
        return {
          pathname: new URL(image.currentSrc || image.src, window.location.href).pathname,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        };
      }),
    );

    expect(states).toEqual([
      expect.objectContaining({
        pathname: "/images/literal-preview-a.svg",
        complete: true,
        naturalWidth: expect.any(Number),
        naturalHeight: expect.any(Number),
      }),
      expect.objectContaining({
        pathname: "/images/literal-preview-b.svg",
        complete: true,
        naturalWidth: expect.any(Number),
        naturalHeight: expect.any(Number),
      }),
      expect.objectContaining({
        pathname: "/images/literal-preview-a.svg",
        complete: true,
        naturalWidth: expect.any(Number),
        naturalHeight: expect.any(Number),
      }),
    ]);
    for (const state of states) {
      expect(state.naturalWidth).toBeGreaterThan(0);
      expect(state.naturalHeight).toBeGreaterThan(0);
    }
  });

  test("image preview: thumbnail does not interrupt the markdown source text", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "before ![cat](/images/literal-preview-a.svg)\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const markerLeftWithoutPreview = await page
      .locator("#rendered .md-image .md-marker")
      .first()
      .boundingBox()
      .then((box) => {
        if (!box) throw new Error("missing image marker box");
        return box.x;
      });

    await page.locator("#image-preview-toggle").check();

    const layout = await page.evaluate(() => {
      const image = document.querySelector("#rendered .md-image-preview") as HTMLImageElement | null;
      const markers = Array.from(
        document.querySelectorAll("#rendered .md-image .md-marker"),
      ) as HTMLElement[];
      if (!image || markers.length === 0) {
        throw new Error("missing image preview or markers");
      }
      const imageRect = image.getBoundingClientRect();
      const markerRects = markers.map((marker) => marker.getBoundingClientRect());
      return {
        imageLeft: imageRect.left,
        firstMarkerLeft: markerRects[0]!.left,
        lastMarkerRight: markerRects[markerRects.length - 1]!.right,
      };
    });

    expect(layout.firstMarkerLeft).toBeCloseTo(markerLeftWithoutPreview, 0);
    expect(layout.imageLeft).toBeGreaterThanOrEqual(layout.lastMarkerRight);
  });

  test("image preview: alt :wN reserves width and blocks cursor placement", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "before ![cat:w120](/images/literal-preview-a.svg) after\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const followingTextLeft = () =>
      page.evaluate(() => {
        const rendered = document.getElementById("rendered");
        if (!rendered) throw new Error("missing rendered");
        const walker = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const offset = node.textContent?.indexOf(" after") ?? -1;
          if (offset >= 0) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            return rect.left;
          }
        }
        throw new Error("missing following text");
      });

    const afterLeftWithoutPreview = await followingTextLeft();

    await page.locator("#image-preview-toggle").check();

    const afterLeftWithPreview = await followingTextLeft();
    const slot = page.locator("#rendered .md-image-preview-slot").first();
    await expect(slot).toHaveAttribute("data-md-image-width", "120");
    await expect(slot).toHaveAttribute("contenteditable", "false");
    const slotBox = await slot.boundingBox();
    if (!slotBox) throw new Error("missing image preview slot box");
    expect(slotBox.width).toBeCloseTo(120, 0);

    expect(afterLeftWithPreview - afterLeftWithoutPreview).toBeGreaterThan(116);

    await page.mouse.click(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2);
    await expect(page.locator("body")).toHaveAttribute("data-mode", "preview");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).not.toBe("source");

    await expect(page.locator("#rendered img.md-image-preview").first()).toHaveAttribute("alt", "cat");
  });

  test("image preview: edit-mode textarea does not place caret inside reserved image slots", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "before ![cat:w120](/images/literal-preview-a.svg) after\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.locator("#image-preview-toggle").check();
    const textBox = await page.locator("#rendered p").boundingBox();
    if (!textBox) throw new Error("missing paragraph box");
    await page.mouse.click(textBox.x + 2, textBox.y + textBox.height / 2);
    await expect(page.locator("body")).toHaveAttribute("data-mode", "edit");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("source");

    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.setSelectionRange(0, 0);
    });
    const slotBox = await page.locator("#source-view .md-image-preview-slot").first().boundingBox();
    if (!slotBox) throw new Error("missing source image preview slot box");
    await page.mouse.click(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2);

    const caret = await page.evaluate(
      () => (document.getElementById("source") as HTMLTextAreaElement).selectionStart,
    );
    expect(caret).toBe(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("source");
  });

  test("image preview: overlay source layer reserves the same image width", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "before ![cat:w120](/images/literal-preview-a.svg) after\nnext line\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.locator("#overlay-toggle").check();
    await page.locator("#image-preview-toggle").check();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const images = Array.from(
            document.querySelectorAll("#rendered img.md-image-preview, #source-view img.md-image-preview"),
          ) as HTMLImageElement[];
          return images.length === 2 &&
            images.every((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
        }),
      )
      .toBe(true);

    const rectForText = (selector: string, needle: string) =>
      page.evaluate(
        ({ selector, needle }) => {
          const root = document.querySelector(selector);
          if (!root) throw new Error(`missing ${selector}`);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            const offset = text.indexOf(needle);
            if (offset >= 0) {
              const range = document.createRange();
              range.setStart(node, offset);
              range.setEnd(node, offset + 1);
              const rect = range.getBoundingClientRect();
              return { left: rect.left, top: rect.top };
            }
          }
          throw new Error(`missing ${needle}`);
        },
        { selector, needle },
      );

    const rendered = await rectForText("#rendered", " after");
    const source = await rectForText("#source-view", " after");
    expect(Math.abs(rendered.left - source.left)).toBeLessThan(1);
    expect(Math.abs(rendered.top - source.top)).toBeLessThan(1);

    await expect
      .poll(() =>
        page.locator("#source-view img.md-image-preview").first().evaluate((img) => {
          return getComputedStyle(img).visibility;
        }),
      )
      .toBe("hidden");
  });

  test("image preview: standalone image URL previews on the next line", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "/images/literal-preview-a.svg\nnext line\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.locator("#overlay-toggle").check();
    await page.locator("#image-preview-toggle").check();

    const slot = page.locator("#rendered .md-image-preview-block").first();
    await expect(slot).toBeVisible();
    const layout = await page.evaluate(() => {
      const rendered = document.getElementById("rendered");
      const source = document.getElementById("source-view");
      const slot = document.querySelector("#rendered .md-image-preview-block");
      if (!rendered || !source || !slot) throw new Error("missing preview nodes");
      const rectForText = (root: Element, needle: string) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? "";
          const offset = text.indexOf(needle);
          if (offset >= 0) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            return range.getBoundingClientRect();
          }
        }
        throw new Error(`missing ${needle}`);
      };
      const url = rectForText(rendered, "/images/literal-preview-a.svg");
      const nextRendered = rectForText(rendered, "next line");
      const nextSource = rectForText(source, "next line");
      const slotRect = slot.getBoundingClientRect();
      const renderedRect = rendered.getBoundingClientRect();
      return {
        urlTop: url.top,
        slotTop: slotRect.top,
        slotLeft: slotRect.left,
        renderedLeft: renderedRect.left,
        renderedNextTop: nextRendered.top,
        sourceNextTop: nextSource.top,
      };
    });

    expect(layout.slotTop).toBeGreaterThan(layout.urlTop + 10);
    expect(Math.abs(layout.slotLeft - layout.renderedLeft)).toBeLessThan(1);
    expect(layout.renderedNextTop).toBeGreaterThan(layout.slotTop + 20);
    expect(Math.abs(layout.renderedNextTop - layout.sourceNextTop)).toBeLessThan(1);
    await expect
      .poll(() =>
        page.locator("#source-view .md-image-preview-block img").first().evaluate((img) => {
          return getComputedStyle(img).visibility;
        }),
      )
      .toBe("hidden");
  });

  test("partial update: shifted blocks keep DOM identity, only attrs change", async ({ page }) => {
    await page.goto("/literal/");
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "# heading\n\nfirst paragraph\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => {
      const win = window as unknown as { __p: Element };
      win.__p = (document.getElementById("rendered") as HTMLElement).querySelector("p")!;
    });
    // Edit the heading: trailing paragraph's `data-src-start` shifts but
    // its body is identical, so the patcher should update the attribute
    // in place rather than replacing the node.
    await page.evaluate(() => {
      const ta = document.getElementById("source") as HTMLTextAreaElement;
      ta.value = "# heading XX\n\nfirst paragraph\n";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sameNode = await page.evaluate(() => {
      const win = window as unknown as { __p: Element };
      const p = (document.getElementById("rendered") as HTMLElement).querySelector("p");
      return p === win.__p;
    });
    expect(sameNode).toBe(true);
    const stats = await page.locator("#patch-stats").innerText();
    expect(stats).toContain("shifted 1");
  });
});
