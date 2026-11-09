# 制作データの自動削除

BE / #22。cleanupExpiredCraftsは15分ごとの定期関数、cleanupLateCraftPhotoは遅れて完了したStorageアップロードを回収するイベント関数です。削除callableは追加しません。

- 未完成はサーバーのupdatedAtから168時間後、完成済みはcompletedAtから168時間後が対象です。transactionで現在の状態・期限を再確認します。
- 親削除とprivateなcraftCleanupJobsの作成を同じtransactionで行い、業務transactionとRulesからのアクセスを止めます。全子孫、craftIdが一致するoperationReceipts、craftごとの全写真世代を回収します。
- 10分のleaseとtokenで重複起動を制御し、失敗はERRORログへ記録します。5分後から再試行可能で、途中終了してもlease失効後に再開します。
- 初回成功後は画像・ownerUidを含まない削除マーカーを8日だけ残します。途中開始のresumable uploadをStorageイベントで回収し、最後にもう一度掃除してマーカーを消します。
- 一実行で完成/未完成を各25件発見し最大50jobを処理。各jobの写真・receipt削除はそれぞれ最大500件とし、残りは次回へ渡します。scan cursorを保存し、不正文書より後ろも確認します。

匿名Auth UID、他のcraft、公開作品/写真、UID単位の利用制限/AI予算カウンターは削除しません。削除マーカーのない親不明データ・旧v1・破損データは期限を推測せず、公開前の移行調査で扱います。

[方針](../../../../docs/decisions/2026-11-06-completion-retention.md) / [運用・公開前確認](../../../../docs/operations/craft-retention.md) / [検証](../../../../docs/qa/retention-cleanup-validation.md)。本番へのデプロイは別途行います。
