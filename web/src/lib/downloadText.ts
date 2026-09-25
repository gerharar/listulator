/**
 * Saves `text` as a file through the browser: a Blob behind a temporary
 * `<a download>`. The desktop app's webview may not honour this (it has no
 * download handler of its own), which is why Export also offers Copy.
 */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
