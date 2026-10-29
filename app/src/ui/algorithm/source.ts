/** 只加载项目生成的独立图文档，再在不含同源权限的沙箱中渲染。 */
export async function loadDiagramSource(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error("流程图读取失败");
  const html = await response.text();
  if (!html.includes('id="live-config"') || !html.includes('Content-Security-Policy'))
    throw new Error("流程图文档格式无效");
  return html;
}
