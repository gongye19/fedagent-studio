/** 推荐页按纯文本排版；保留段落、列表和原意，去掉模型返回的 Markdown 装饰。 */
export function adviceText(text: string): string {
  return text.replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.*?)\*\*/g, "$1");
}
