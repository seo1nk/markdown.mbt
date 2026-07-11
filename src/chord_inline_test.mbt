///| Fork extension: inline chords `:2m7:` (single chord symbol between colons).

///| Parsed as Inline::ChordInline when the token is a valid chord-language

///| chord symbol; anything else stays plain text. See e2e/chord.spec.ts for

///| the playground integration.

///|
test "parse inline chord in paragraph" {
  let result = parse("ここで :2m7: に行く\n")
  match result.document.children[0] {
    Block::Paragraph(children~, ..) => {
      @debug.debug_inspect(children.length(), content="3")
      match children[1] {
        Inline::ChordInline(src~, ..) =>
          @debug.debug_inspect(
            src,
            content=(
              #|"2m7"
            ),
          )
        _ => fail("Expected ChordInline")
      }
    }
    _ => fail("Expected paragraph")
  }
}

///|
/// SSR 経路: ディグリー表示のインライン span になる（色クラスも付く）
test "inline chord renders via md_to_html" {
  let html = md_to_html("ここで :2m7: から :b3@red: へ\n")
  assert_true(html.contains("<span class=\"chord-inline\">IIm7</span>"))
  assert_true(
    html.contains("<span class=\"chord-inline chord--red\">♭III</span>"),
  )
  // 複雑なコード記号（テンション・スラッシュベース）も 1 トークンで通る
  let html2 = md_to_html(":s4m7-5/b7: と :1M7(9,#11):\n")
  assert_true(html2.contains(">#IVm7♭5/♭VII</span>"))
  assert_true(html2.contains(">IM7(9,#11)</span>"))
}

///|
/// コード記号としてパースできないトークンは平文のまま（エラーにしない）
test "invalid inline chord tokens stay plain text" {
  let html = md_to_html("絵文字の :smile: や :8: は平文\n")
  assert_true(!html.contains("chord-inline"))
  assert_true(html.contains(":smile:"))
  assert_true(html.contains(":8:"))
}

///|
/// 誤爆防止: 開き : の直前・閉じ : の直後が半角英数字なら記法にしない
/// （時刻・比・URL などの散文中のコロンを保護する）
test "inline chord flanking rules protect prose colons" {
  let html = md_to_html(
    "比は 3:4:5、時刻は 10:30:45、URL は http://x:8080/\n",
  )
  assert_true(!html.contains("chord-inline"))
  // 前後が英数字でなければ文中でも成立する
  let html2 = md_to_html("（:4:）\n")
  assert_true(html2.contains("<span class=\"chord-inline\">IV</span>"))
}

///|
/// 空・空白入り・過長トークンは記法にしない
test "inline chord rejects empty and whitespace tokens" {
  let html = md_to_html(":: や : 1 4 : はそのまま\n")
  assert_true(!html.contains("chord-inline"))
}

///|
/// ロスレス性: インラインコード譜は :token: のまま直列化される
test "inline chord serializes back to colons" {
  let src = "ここで :2m7: に行く\n"
  let result = parse(src)
  let out = serialize(result.document)
  @debug.debug_inspect(
    out,
    content=(
      #|"ここで :2m7: に行く\n"
    ),
  )
}

///|
/// strict モード（delimiter stack 経路）でも同様にパースされる
test "inline chord parses in strict mode" {
  let html = md_to_html_strict("**強調** の中でなく外の :5(9): も\n")
  assert_true(html.contains("<span class=\"chord-inline\">V(9)</span>"))
}

///|
/// literal レンダラ: 可視テキストは元ソースのまま（コロンはマーカー span）
test "inline chord literal rendering keeps source glyphs" {
  let html = md_to_html_literal("ここで :2m7: に行く\n")
  assert_true(html.contains("md-chord-inline"))
  assert_true(
    html.contains(
      "<span class=\"md-chord-inline\"><span class=\"md-marker\" aria-hidden=\"true\">:</span>2m7<span class=\"md-marker\" aria-hidden=\"true\">:</span></span>",
    ),
  )
}
