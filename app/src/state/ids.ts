/** 前端原型里新建对象的 id：时间 + 随机后缀。接入后端后改用后端返回的 id。 */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
