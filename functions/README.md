# Cloud Functions

担当: BE okaka-1205。npm ciはrootで実行します。
現在の公開関数はhealth（認証必須）、createCraft（単独制作の下書き作成）、recognizeMaterials（本人の材料写真の認識）、editMaterials（保存/再編集）、confirmMaterials（材料確定/候補生成）、startCraft（作品固定/全工程初期化/開始）、completeStep（本人の順序付き工程完了）、completeCraft（本人の完成記録/7日後の削除予定）です。
ルーム作成/参加/受付終了の公開関数は削除しました。

自動処理はcleanupExpiredCrafts（15分ごとの期限削除）とcleanupLateCraftPhoto（削除中/削除後に完了した写真の回収）です。未完成は最終更新から7日、完成後は完成から7日で対象にします。削除callableは追加しません。[運用と本番反映の境界](../docs/operations/craft-retention.md)を参照してください。

reservePhotoUploadで写真の作成枠を予約します。制作/UID/プロジェクト全体の枚数・総量をtransactionで計上し、Storageは予約と実サイズ/MIMEを照合します。[契約](../docs/api/photo-uploads-v2.md)を参照してください。

src/libに所有者認可、strict入力、Timestamp変換を置き、業務処理はsrc/featuresへ分けます。
材料保存/候補判定は[材料API v2](../docs/api/materials-v2.md)、開始/工程完了は[制作API v2](../docs/api/production-v2.md)、完成記録は[完成API v2](../docs/api/completion-v2.md)を参照してください。
npm run build:functionsでsharedを含むlib/index.jsを作り、ローカル起動・結合検証はrootのスクリプトを使います。
scripts/build.mjsがcontent/templates/*.jsonと工程写真の存在を検証し、カタログをbundleに埋め込みます。テスト用合成作品は埋め込みません。これは旧カタログの互換経路です。新規画面はgenerateProjectsが同梱するAIの3案を使い、作品登録待ちにはなりません。
Secretは本番のSecret ManagerまたはGit管理外の.secret.localへ置き、クライアントへ渡しません。

## 材料から3案とギャラリー（v3）

`generateProjects`、`listMyCrafts`、`publishCraft`、`listGallery`、`galleryAction`を追加。既存の制作開始・工程完了・完成APIを継続利用します。詳細は[現行仕様](../docs/specifications/co-make-v3-1.md)を参照。`PROJECT_GENERATION_MODE`は既定でdisabled、`CO_MAKE_AI_FIXTURES=1`はdemoのEmulatorのみです。
