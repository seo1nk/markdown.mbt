///|
/// Tests for the source-preserving (literal) HTML renderer.
///|
/// The key invariant: stripping HTML tags + decoding the basic character
/// references (`&amp; &lt; &gt; &quot;`) from `render_html_literal(doc)`
/// must yield exactly `serialize(doc)`. This is what makes the rendered
/// output overlay-able with a syntax-highlighted source view under
/// monospace + `white-space: pre-wrap`.

///|
/// Strip HTML tags and decode the basic XML character references.
/// Mirrors what a browser's text-rendering engine would emit (visible
/// characters only) under `white-space: pre-wrap`.
fn strip_html(html : String) -> String {
  let buf = StringBuilder::new()
  let len = html.length()
  let mut i = 0
  while i < len {
    let c = html.get_char(i)
    match c {
      Some('<') => {
        // Skip everything up to and including the matching `>`.
        let mut j = i + 1
        while j < len {
          match html.get_char(j) {
            Some('>') => {
              j += 1
              break
            }
            _ => j += 1
          }
        }
        i = j
      }
      Some('&') => {
        // Decode &amp; &lt; &gt; &quot; &#39;
        let starts_with = fn(prefix : String) -> Bool {
          let n = prefix.length()
          i + n <= len &&
          html.unsafe_substring(start=i, end=i + n) == prefix
        }
        if starts_with("&amp;") {
          buf.write_char('&')
          i += 5
        } else if starts_with("&lt;") {
          buf.write_char('<')
          i += 4
        } else if starts_with("&gt;") {
          buf.write_char('>')
          i += 4
        } else if starts_with("&quot;") {
          buf.write_char('"')
          i += 6
        } else if starts_with("&#39;") {
          buf.write_char('\'')
          i += 5
        } else {
          buf.write_char('&')
          i += 1
        }
      }
      Some(ch) => {
        buf.write_char(ch)
        i += 1
      }
      None => i += 1
    }
  }
  buf.to_string()
}

///|
/// Assert that `strip_html(render_html_literal(parse(src))) == serialize(parse(src))`.
fn assert_overlay_invariant(src : String) -> Unit raise {
  let doc = parse(src).document
  let expected = serialize(doc)
  let rendered = render_html_literal(doc)
  let stripped = strip_html(rendered)
  assert_eq(stripped, expected)
}

// =============================================================================
// Snapshot tests for HTML output
// =============================================================================

///|
test "literal: paragraph plain text" {
  let html = md_to_html_literal("hello world\n")
  @debug.debug_inspect(html, content=(
    #|"<p>hello world</p>\n"

  ))
}

///|
test "literal: heading atx" {
  let html = md_to_html_literal("## Intro\n")
  @debug.debug_inspect(html, content=(
    #|"<h2><span class=\"md-marker\" aria-hidden=\"true\">## </span>Intro</h2>\n"

  ))
}

///|
test "literal: emphasis and strong" {
  let html = md_to_html_literal("*em* and **strong**\n")
  @debug.debug_inspect(html, content=(
    #|"<p><em><span class=\"md-marker\" aria-hidden=\"true\">*</span>em<span class=\"md-marker\" aria-hidden=\"true\">*</span></em> and <strong><span class=\"md-marker\" aria-hidden=\"true\">**</span>strong<span class=\"md-marker\" aria-hidden=\"true\">**</span></strong></p>\n"

  ))
}

///|
test "literal: inline code" {
  let html = md_to_html_literal("hello `code` world\n")
  @debug.debug_inspect(html, content=(
    #|"<p>hello <code><span class=\"md-marker\" aria-hidden=\"true\">`</span>code<span class=\"md-marker\" aria-hidden=\"true\">`</span></code> world</p>\n"

  ))
}

///|
test "literal: bullet list" {
  let html = md_to_html_literal("- one\n- two\n")
  @debug.debug_inspect(html, content=(
    #|"<ul><li><span class=\"md-marker\" aria-hidden=\"true\">* </span>one\n</li><li><span class=\"md-marker\" aria-hidden=\"true\">* </span>two\n</li></ul>"


  ))
}

///|
test "literal: link" {
  let html = md_to_html_literal("see [docs](https://example.com)\n")
  @debug.debug_inspect(html, content=(
    #|"<p>see <a href=\"https://example.com\"><span class=\"md-marker\" aria-hidden=\"true\">[</span>docs<span class=\"md-marker\" aria-hidden=\"true\">](https://example.com)</span></a></p>\n"

  ))
}

///|
test "literal: autolink" {
  let html = md_to_html_literal("<https://example.com>\n")
  @debug.debug_inspect(html, content=(
    #|"<p><a href=\"https://example.com\"><span class=\"md-marker\" aria-hidden=\"true\">&lt;</span>https://example.com<span class=\"md-marker\" aria-hidden=\"true\">&gt;</span></a></p>\n"

  ))
}

// =============================================================================
// Invariant tests: stripped HTML == serialize(doc)
// =============================================================================

///|
test "invariant: paragraph" {
  assert_overlay_invariant("hello world\n")
}

///|
test "invariant: heading levels" {
  assert_overlay_invariant("# h1\n\n## h2\n\n### h3\n")
}

///|
test "invariant: emphasis strong code" {
  assert_overlay_invariant("*em* **strong** `code`\n")
}

///|
test "invariant: bullet list" {
  assert_overlay_invariant("- one\n- two\n- three\n")
}

///|
test "invariant: ordered list" {
  assert_overlay_invariant("1. one\n2. two\n3. three\n")
}

///|
test "invariant: nested bullet list" {
  assert_overlay_invariant("- outer\n  - inner\n")
}

///|
test "invariant: link" {
  assert_overlay_invariant("see [docs](https://example.com)\n")
}

///|
test "invariant: autolink" {
  assert_overlay_invariant("<https://example.com>\n")
}

///|
test "invariant: fenced code" {
  assert_overlay_invariant("```rust\nfn main() {}\n```\n")
}

///|
test "invariant: blockquote single paragraph" {
  assert_overlay_invariant("> quote text\n")
}

///|
test "invariant: blockquote multi-line" {
  assert_overlay_invariant("> line one\n> line two\n")
}

///|
test "invariant: thematic break" {
  assert_overlay_invariant("***\n")
}

///|
test "invariant: mixed document" {
  assert_overlay_invariant(
    #|# Title
    #|
    #|A paragraph with *em*, **strong**, and `code`.
    #|
    #|- bullet one
    #|- bullet two
    #|
    #|> a quote
    #|
    #|See <https://example.com> for details.
    #|
    ,
  )
}
