///| Fork extension: ::: fences open a chord block (parsed as FencedCode with
///| FenceMarker::Colon). See e2e/chord.spec.ts for the playground integration.

///|
test "parse colon fence as chord block" {
  let result = parse(":::\n1 3m7 4M7 5 | b7 1\n:::\n")
  match result.document.children[0] {
    Block::FencedCode(info~, code~, fence_marker~, fence_length~, ..) => {
      @debug.debug_inspect(fence_marker, content="Colon")
      @debug.debug_inspect(fence_length, content="3")
      @debug.debug_inspect(
        info,
        content=(
          #|""
        ),
      )
      @debug.debug_inspect(
        code,
        content=(
          #|"1 3m7 4M7 5 | b7 1\n"
        ),
      )
    }
    _ => fail("Expected fenced code (colon)")
  }
}

///|
test "colon fence serializes back to colons" {
  let src = ":::\n1 4 5\n:::\n"
  let result = parse(src)
  let out = serialize(result.document)
  @debug.debug_inspect(
    out,
    content=(
      #|":::\n1 4 5\n:::\n"
    ),
  )
}

///|
test "colon fence with frontmatter content is preserved verbatim" {
  // フロントマター（--- 区切り）は chord-language 側がパースする。
  // markdown.mbt はブロック内容を不透明なテキストとして保持するだけ。
  let src = ":::\n---\nkey: G\n---\n1 4 5\n:::\n"
  let result = parse(src)
  match result.document.children[0] {
    Block::FencedCode(code~, fence_marker~, ..) => {
      @debug.debug_inspect(fence_marker, content="Colon")
      @debug.debug_inspect(
        code,
        content=(
          #|"---\nkey: G\n---\n1 4 5\n"
        ),
      )
    }
    _ => fail("Expected fenced code (colon)")
  }
}

///|
test "backtick and tilde fences are unaffected" {
  let result = parse("```js\nconst x = 1;\n```\n")
  match result.document.children[0] {
    Block::FencedCode(fence_marker~, ..) =>
      @debug.debug_inspect(fence_marker, content="Backtick")
    _ => fail("Expected fenced code")
  }
  let out = serialize(result.document)
  @debug.debug_inspect(
    out,
    content=(
      #|"```js\nconst x = 1;\n```\n"
    ),
  )
}
