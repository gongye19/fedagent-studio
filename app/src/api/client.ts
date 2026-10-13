/**
 * 后端 API 的调用。类型由后端的 OpenAPI 生成（npm run api:types → schema.d.ts），接口一改，类型检查就会报错。
 * 和前端同一个地址（开发时由 Vite 转发 /v1）；设置了访问令牌的部署，令牌保存在浏览器本地，每次请求带上。
 */
import type { components } from "./schema";

type S = components["schemas"];

const TOKEN_KEY = "fedagent-studio:token";
let sessionToken: string | null = null;

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return sessionToken;
  }
}

export function setToken(token: string | null): void {
  sessionToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 存储不可用时只在这次打开的页面里有效
  }
}

/** 后端返回的错误。detail 是后端写明的原因：一句话，或带 issues（任务配置的问题）、check（数据文件的检查结果）。 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown) {
    super(messageOf(status, detail));
    this.status = status;
    this.detail = detail;
  }

  get issues(): S["IssueOut"][] {
    const detail = this.detail as { issues?: S["IssueOut"][] } | null;
    return detail && Array.isArray(detail.issues) ? detail.issues : [];
  }

  get check(): S["DatasetCheckOut"] | null {
    const detail = this.detail as { check?: S["DatasetCheckOut"] } | null;
    return detail?.check ?? null;
  }
}

function messageOf(status: number, detail: unknown): string {
  if (status === 0) return "连不上后端服务，稍后再试";
  if (typeof detail === "string") return detail;
  const check = (detail as { check?: S["DatasetCheckOut"] } | null)?.check;
  if (check && check.problems.length) {
    const first = check.problems[0];
    return `数据文件有 ${check.problemCount} 处问题，例如${first.line ? `第 ${first.line} 行：` : ""}${first.message}`;
  }
  const issues = (detail as { issues?: S["IssueOut"][] } | null)?.issues;
  if (issues && issues.length) return issues.map((issue) => issue.message).join("；");
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  if (status === 401) return "需要访问令牌";
  if (status === 422) return "提交的内容格式不对";
  return `请求失败（${status}）`;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, cache: "no-store", signal });
  } catch {
    throw new ApiError(0, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = data && typeof data === "object" && "detail" in data ? (data as { detail: unknown }).detail : data;
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
const del = (path: string) => request<void>("DELETE", path);
const query = (values: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)]));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type TaskConfigIn = S["TaskConfigIn"];

export const api = {
  meta: () => get<S["MetaOut"]>("/v1/meta"),
  registry: () => get<S["RegistryOut"]>("/v1/registry"),

  participants: () => get<S["ParticipantOut"][]>("/v1/participants"),
  /** 新增参与方，同时登记它的第一份数据集（表单：name、org、intro、hosting、datasetName、datasetDescription、scenario、taskType、file）。 */
  createParticipant: (form: FormData) => post<S["ParticipantOut"]>("/v1/participants", form),
  deleteParticipant: (id: string) => del(`/v1/participants/${encodeURIComponent(id)}`),
  issueClientToken: (id: string) => post<S["ClientTokenOut"]>(`/v1/participants/${encodeURIComponent(id)}/client-tokens`),

  datasets: () => get<S["DatasetOut"][]>("/v1/datasets"),
  createDataResource: (form: FormData) => post<S["DataResourceOut"]>("/v1/resources/data", form),
  deleteDataResource: (id: string) => del(`/v1/resources/data/${encodeURIComponent(id)}`),
  checkDataset: (taskType: string, file: File, signal?: AbortSignal) => {
    const data = new FormData();
    data.set("taskType", taskType);
    data.set("file", file, file.name);
    return request<S["DatasetCheckOut"]>("POST", "/v1/datasets/check", data, signal);
  },
  downloadTemplate: (taskType: string) => download(`/v1/task-types/${encodeURIComponent(taskType)}/template`, "dataset-template.jsonl"),
  createDataset: (form: FormData) => post<S["DatasetOut"]>("/v1/datasets", form),
  deleteDataset: (id: string) => del(`/v1/datasets/${encodeURIComponent(id)}`),

  endpoints: () => get<S["EndpointOut"][]>("/v1/endpoints"),
  createEndpoint: (body: S["EndpointIn"]) => post<S["EndpointOut"]>("/v1/endpoints", body),
  updateEndpoint: (id: string, body: S["EndpointIn"]) => put<S["EndpointOut"]>(`/v1/endpoints/${encodeURIComponent(id)}`, body),
  deleteEndpoint: (id: string) => del(`/v1/endpoints/${encodeURIComponent(id)}`),
  testEndpoint: (id: string) => post<S["EndpointTestOut"]>(`/v1/endpoints/${encodeURIComponent(id)}/test`),
  /** 读接口地址提供的模型（选模型用）；没填密钥时用 endpointId 这个接口已保存的密钥。 */
  previewModels: (body: S["ModelListIn"]) => post<S["EndpointModelsOut"]>("/v1/endpoints/models", body),

  validateTask: (body: TaskConfigIn) => post<S["ValidateOut"]>("/v1/tasks/validate", body),
  createTask: (body: TaskConfigIn) => post<S["TaskOut"]>("/v1/tasks", body),
  tasks: () => get<S["TaskOut"][]>("/v1/tasks"),
  task: (id: string) => get<S["TaskOut"]>(`/v1/tasks/${encodeURIComponent(id)}`),
  deleteTask: (id: string) => del(`/v1/tasks/${encodeURIComponent(id)}`),
  controlTask: (id: string, action: "pause" | "resume" | "cancel") => post<S["TaskOut"]>(`/v1/tasks/${encodeURIComponent(id)}/${action}`),
  taskMessages: (id: string, filter: { round?: number; site?: string; limit?: number }) =>
    get<S["MessageOut"][]>(`/v1/tasks/${encodeURIComponent(id)}/messages${query(filter)}`),
  taskEvents: (id: string) => get<S["EventOut"][]>(`/v1/tasks/${encodeURIComponent(id)}/events`),

  appContent: (id: string) => get<unknown>(`/v1/apps/${encodeURIComponent(id)}/export`),
  apps: () => get<S["AppOut"][]>("/v1/apps"),
  publish: (body: S["AppIn"]) => post<S["AppOut"]>("/v1/apps", body),
  renameApp: (id: string, name: string) => patch<S["AppOut"]>(`/v1/apps/${encodeURIComponent(id)}`, { name }),
  withdrawApp: (id: string) => del(`/v1/apps/${encodeURIComponent(id)}`),
  applyApp: (id: string, body: S["ApplyIn"]) => post<S["ApplyOut"]>(`/v1/apps/${encodeURIComponent(id)}/apply`, body),

  /** 下载应用的导出文件（带上访问令牌，所以不能直接用链接）。 */
  exportApp: (id: string) => download(`/v1/apps/${encodeURIComponent(id)}/export`, "export.json"),
};

async function download(path: string, fallback: string): Promise<void> {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, { headers });
    if (!response.ok) throw new ApiError(response.status, null);
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
