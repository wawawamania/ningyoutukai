// api の 422 は「入力が正しくありません: productName」のように項目名が英語で出るので、既知の項目名だけ日本語にする
const fieldNames: Record<string, string> = {
  productName: 'プロダクト名',
  taskTypeName: '種類の名前',
  taskName: 'タスク名',
  description: '説明',
  timeLimit: '期限',
  githubId: 'GitHub のユーザー名',
  email: 'メールアドレス',
}

export function errorMessage(message: string): string {
  return message.replace(/[A-Za-z]+/g, (word) => fieldNames[word] ?? word)
}
