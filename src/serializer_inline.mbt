///| Inline serialization (text, emphasis, links, images, code spans, ...).

///|

///| Split from serializer.mbt to keep that file focused on block-level

///| serialization. Table-cell variants and wikilink escaping live here

///| because they are part of the same inline-rendering surface.

///|
/// Serialize inline content
fn serialize_inlines(inlines : Array[Inline], buf : StringBuilder) -> Unit {
  for inline in inlines {
    serialize_inline(inline, buf)
  }
}

///|
/// Serialize table cell inline content (escapes pipes)
fn serialize_table_cell_inlines(
  inlines : Array[Inline],
  buf : StringBuilder,
) -> Unit {
  for inline in inlines {
    serialize_table_cell_inline(inline, buf)
  }
}

///|
/// Serialize a single inline element for table cells (escapes pipes in text)
fn serialize_table_cell_inline(inline : Inline, buf : StringBuilder) -> Unit {
  match inline {
    Inline::Text(content~, ..) =>
      // Escape pipe characters in table cells
      for c in content {
        if c == '|' {
          buf.write_string("\\|")
        } else {
          buf.write_char(c)
        }
      }
    // For other inline types, delegate to regular serialization
    _ => serialize_inline(inline, buf)
  }
}

///|
/// Escape characters that would terminate or split a wiki link.
fn serialize_wikilink_part(value : String, buf : StringBuilder) -> Unit {
  for c in value {
    match c {
      '\\' | '|' | ']' => {
        buf.write_char('\\')
        buf.write_char(c)
      }
      _ => buf.write_char(c)
    }
  }
}

///|
fn serialize_wikilink_destination(target : String, fragment : String) -> String {
  if fragment.is_empty() {
    target
  } else {
    target + "#" + fragment
  }
}

///|
/// Serialize a single inline element
fn serialize_inline(inline : Inline, buf : StringBuilder) -> Unit {
  match inline {
    Inline::Text(content~, ..) => buf.write_string(content)
    Inline::SoftBreak(..) => buf.write_char('\n')
    Inline::HardBreak(..) =>
      // remark uses backslash style by default
      buf.write_string("\\\n")
    Inline::Emphasis(children~, ..) => {
      // Always use * for GFM compatibility (remark default)
      buf.write_char('*')
      serialize_inlines(children, buf)
      buf.write_char('*')
    }
    Inline::Strong(children~, ..) => {
      // Always use ** for GFM compatibility (remark default)
      buf.write_string("**")
      serialize_inlines(children, buf)
      buf.write_string("**")
    }
    Inline::Strikethrough(children~, ..) => {
      buf.write_string("~~")
      serialize_inlines(children, buf)
      buf.write_string("~~")
    }
    Inline::Code(content~, ..) => {
      // Calculate minimum backticks needed (must not match any run in content)
      let backticks = calc_code_span_backticks(content)
      write_chars(buf, '`', backticks)
      // Add padding space if content starts/ends with backtick
      // (Spaces at both ends need padding only if NOT all spaces, to prevent trimming)
      let needs_padding = content.length() > 0 &&
        ({
          let first = content.get_char(0)
          let last = content.get_char(content.length() - 1)
          first == Some('`') || last == Some('`')
        })
      if needs_padding {
        buf.write_char(' ')
      }
      buf.write_string(content)
      if needs_padding {
        buf.write_char(' ')
      }
      write_chars(buf, '`', backticks)
    }
    Inline::WikiLink(target~, label~, fragment~, ..) => {
      let destination = serialize_wikilink_destination(target, fragment)
      buf.write_string("[[")
      serialize_wikilink_part(destination, buf)
      if !label.is_empty() {
        buf.write_char('|')
        serialize_wikilink_part(label, buf)
      }
      buf.write_string("]]")
    }
    Inline::Link(children~, url~, title~, ..) => {
      buf.write_char('[')
      serialize_inlines(children, buf)
      buf.write_string("](")
      buf.write_string(url)
      if !title.is_empty() {
        buf.write_string(" \"")
        buf.write_string(title)
        buf.write_char('"')
      }
      buf.write_char(')')
    }
    Inline::RefLink(children~, label~, ..) => {
      buf.write_char('[')
      serialize_inlines(children, buf)
      buf.write_string("][")
      buf.write_string(label)
      buf.write_char(']')
    }
    Inline::Autolink(url~, ..) => {
      buf.write_char('<')
      buf.write_string(url)
      buf.write_char('>')
    }
    Inline::Image(alt~, url~, title~, ..) => {
      buf.write_string("![")
      buf.write_string(alt)
      buf.write_string("](")
      buf.write_string(url)
      if !title.is_empty() {
        buf.write_string(" \"")
        buf.write_string(title)
        buf.write_char('"')
      }
      buf.write_char(')')
    }
    Inline::RefImage(alt~, label~, ..) => {
      buf.write_string("![")
      buf.write_string(alt)
      buf.write_string("][")
      buf.write_string(label)
      buf.write_char(']')
    }
    Inline::HtmlInline(html~, ..) => buf.write_string(html)
    Inline::FootnoteReference(label~, ..) => {
      buf.write_string("[^")
      buf.write_string(label)
      buf.write_char(']')
    }
  }
}
