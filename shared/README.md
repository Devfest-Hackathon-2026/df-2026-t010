# 共有契約 v2

TypeScriptとstrict Zodの正本です。API・mock・Firebaseアダプターで同じ契約を使います。

- common.ts: ID / UUID v4 / ISO UTC日時
- crafts.ts: 所有者1人の制作、4状態、createCraft、購読
- workshop.ts: 材料/工具/確認条件、検証済み/AI作品と順序付き工程、候補/進捗/完成、API入力
- material-recognition.ts: v2の画像参照・世代・認識結果
- errors.ts: schemaVersion=2の共通エラー
- fixtures.ts: 下書き・材料・候補なし・工程・拒否/古い版。架空の作品/写真はテスト専用

[API引き渡し](../docs/api/crafts-v2.md)と[プロダクト仕様](../docs/specifications/reuse-craft-v2.md)を参照します。
v1のルーム・メンバー・主催者・人数・割当・AI工程ヘルプの型は削除しました。

- project-ideas.ts: 材料から生成する3案の検証と体験版サンプル。
- gallery.ts: 任意公開・コメント/反応・本人履歴。

プロダクト仕様は[v3.1](../docs/specifications/co-make-v3-1.md)。共有schemaVersionは2を継続する。
