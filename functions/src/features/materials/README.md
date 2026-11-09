# 材料API

BE / #10・#33。材料認識と確定を担当します。画像参照はFE1の#9、編集UIは#11と合わせます。

#10のrecognizeMaterialsはindex.ts（callable/Secret）、service.ts（認可/冪等性/試行上限）、image.ts（Storage画像）、output.ts（候補検証）に分けています。
API契約は[材料認識v1](../../../../docs/api/material-recognition-v1.md)。材料の保存/確定は#33で実装します。
既定はAI_DISABLED。固定応答はdemo-co-makeのEmulatorだけで動き、実Geminiの利用開始・デプロイは別途確認します。
