// Cloudflare Workers (static assets) デプロイ用のステージング。
// kseo.ink/works/md-chord* のルートで配信されるため、アセットは
// works/md-chord/ プレフィックス付きのディレクトリ構造に置く。
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync(".deploy", { recursive: true, force: true });
mkdirSync(".deploy/works", { recursive: true });
cpSync("dist-playground", ".deploy/works/md-chord", { recursive: true });
console.log("staged dist-playground -> .deploy/works/md-chord");
