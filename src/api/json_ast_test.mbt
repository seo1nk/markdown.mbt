///|
/// fork: インラインコード譜は mdast にない独自ノード {type: "chordInline"}
/// にマップされる（プレビューのインラインレンダラが処理する）
test "inline chord maps to chordInline mdast node" {
  let json = @api.md_to_ast_json("ここで :2m7: に行く\n")
  assert_true(json.contains("\"type\":\"chordInline\""))
  assert_true(json.contains("\"value\":\"2m7\""))
}
