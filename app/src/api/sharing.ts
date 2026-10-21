import { request } from "./client";

export type ResourceKind = "data" | "llm" | "agent";

export async function setResourceShared(
  kind: ResourceKind,
  id: string,
  shared: boolean,
) {
  await request(
    "PATCH",
    `/v1/resources/${kind}/${encodeURIComponent(id)}/sharing`,
    { shared },
  );
}
