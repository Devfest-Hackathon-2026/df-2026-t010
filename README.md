# Rekt

Rektは、空き箱や紙など、捨てる前の身近な材料を工作に使うためのスマートフォン向けWebアプリです。材料を撮影または手入力すると、手元の材料と工具からAIが工作案を3つ提案します。選んだ作品は工程ごとに進捗を保存でき、完成した作品は希望する場合にギャラリーで共有できます。

[Rektを開く](https://gdgoc2026-comake.web.app/)

チームは **UoA34**、参加区分はオンラインです。提出ソースは開発用mainの `14dd7a1` 時点です。公開Webの配信版は [release.json](https://gdgoc2026-comake.web.app/release.json) で確認できます。

## 本番で試す

1. ホームの「つくる」で手元の工具を選びます。
2. 材料を撮影して認識結果を確認します。手入力で試す場合は、例として画用紙2枚を登録します。
3. 「この材料で確定する」を押し、3案から選んで「つくりはじめる」を押します。
4. 工程を進め、写真付きまたは写真なしで完成を記録します。途中の作品は同じブラウザーの「つくった作品」から再開できます。

登録操作は不要です。Firebase Authenticationの匿名認証で制作を保存します。

## ローカルで起動・検証

Node.js 22を使います。バージョンは [.nvmrc](.nvmrc) に記載しています。

```bash
npm ci
npm run dev
```

[http://localhost:5173](http://localhost:5173) で、ローカルのサンプルを使って制作の流れを試せます。本番URLでは、実際の写真認識と材料に応じた作品案の生成を試せます。

| コマンド | 内容 |
| --- | --- |
| `npm run check` | lint、型検査、テスト、WebとFunctionsのビルド |
| `npm run dev:full:fixtures` | Firebase Emulatorに接続し、写真認識と3案生成は固定応答で確認 |
| `npm run test:emulators` | 所有者の認可、写真アップロード、工程、ギャラリーなどの結合テスト |

Firebase Emulatorの実行にはJava 21以上が必要です。ローカルのサンプルと固定応答ではAPIキーなしで動作します。

## 構成

- [src](src) にReactとTypeScriptの画面、[functions](functions) にCloud Functions for Firebase（第2世代）、[shared](shared) に共有スキーマと入力・出力の検証を置いています。
- Firebase Hostingで画面を配信します。Cloud Firestoreに材料・工程・投稿を、Cloud Storageに材料写真と完成写真を保存します。
- Cloud Run上のFunctionsで認証・App Check・所有者を確認し、保存とAI呼び出しを扱います。写真アップロードは事前予約と送信時の形式・サイズ照合を行います。
- Cloudflare Workers AIが写真から材料候補を読み取り、確定した材料・工具から選択中の言語で工作案を3つ生成します。サーバーは材料の種類・数量、工具、工程の制約を検証します。

## ライセンス

コードは [MIT License](LICENSE) です。画面のPhosphor Iconsのライセンス表記は [public/phosphor-LICENSE.txt](public/phosphor-LICENSE.txt) にあります。
