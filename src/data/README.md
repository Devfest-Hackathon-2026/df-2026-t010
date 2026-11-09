# 接続層

担当はFE2。プロダクトは[仕様v3.1](../../docs/specifications/co-make-v3-1.md)、型はcontracts.tsとshared/srcを正とする。

CraftGatewayは作成/購読、MaterialsGatewayは写真/認識/材料編集、ProjectsGatewayは3案生成/候補購読、ExperienceGatewayは制作/完成/写真/履歴/ギャラリーを担当する。index.tsがmockとFirebaseを選ぶ。mockモードではFirebaseモジュールを読み込まない。

mockの制作・投稿・反応はlocalStorage、完成写真はIndexedDB。クラウドの認可・transaction・自動削除・費用枠と同等ではない。Firebaseアダプターは匿名UIDへ復帰し、応答と文書をZodで検証する。

基本接続はPR #65で統合済み。画面からの実API/切断復帰、私有写真と体験版の期限差異は#17、ギャラリーの一覧外詳細/保存/公開境界は#67、実モデルは#66で確認する。別gatewayや仮の常時エラー入口を重複実装しない。

[API](../../docs/api/ideas-gallery-v3.md) / [FE2担当資料](../../docs/team/fe2.md)
