export const materialRecognitionFixtures = {
  ja: { items: [{ name: '段ボール', quantity: 2, unit: '枚', confidence: 0.82 }], warnings: ['固定応答による開発用データです。実画像の認識結果ではありません。'] },
  en: { items: [{ name: 'Cardboard', quantity: 2, unit: 'sheets', confidence: 0.82 }], warnings: ['Development fixture. This is not a recognition result from the uploaded image.'] },
  empty: { items: [], warnings: ['材料を特定できません。実物を見て手動で入力してください。'] },
  malformed: { items: [{ name: '段ボール', quantity: -1, unit: '枚', confidence: 2 }], warnings: [] },
} as const
