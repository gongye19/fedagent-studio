import { useState } from "react";
import type { ResourceKind } from "../../api/sharing";
import { setResourceShared } from "../../state/actions";
import { Confirm } from "../common";

export function SharingButton({
  kind,
  resource,
}: {
  kind: ResourceKind;
  resource: {
    id: string;
    name: string;
    resourceSpace: string;
    shared: boolean;
  };
}) {
  const [confirming, setConfirming] = useState(false);
  if (resource.resourceSpace !== "workspace") return null;
  return (
    <>
      <button
        type="button"
        className="button button--ghost button--compact"
        onClick={() => setConfirming(true)}
      >
        {resource.shared ? "取消共享" : "共享"}
      </button>
      {confirming ? (
        <Confirm
          title={`${resource.shared ? "取消共享" : "共享"}“${resource.name}”？`}
          confirmLabel={resource.shared ? "取消共享" : "共享"}
          cancelLabel="返回"
          tone={resource.shared ? "danger" : "primary"}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await setResourceShared(kind, resource.id, !resource.shared);
            setConfirming(false);
          }}
        >
          {resource.shared
            ? "取消后，其他系统的新任务不能再选择这项资源。已开始的任务继续运行，资源仍保留在我的资源中。"
            : kind === "data"
              ? "共享后，平台内其他使用者可以在任务中使用这份数据。共享状态可随时取消。"
              : `共享后，平台内其他使用者可以通过平台调用这个 ${kind === "agent" ? "Agent" : "LLM"} 接口，会消耗接口额度。API 密钥不会展示。${kind === "agent" ? "它的数据需要单独共享。" : ""}`}
        </Confirm>
      ) : null}
    </>
  );
}
