# 完成記録API

BE / #34。所有者と固定作品の全工程完了を検証し、completedと完成日時を原子的に保存します。
完成写真は任意。写真アップロードのRulesとライフサイクルはこのIssueで実装します。
index.tsがcompleteCraftを公開し、operations.tsが所有者/全工程/再送/原子的保存を、photo.tsがStorage写真の実バイト検証を担当します。完成後7日のdeleteAfterを記録し、自動削除は#22で実装します。
[契約とFEへの引き渡し](../../../../docs/api/completion-v2.md)を参照してください。
