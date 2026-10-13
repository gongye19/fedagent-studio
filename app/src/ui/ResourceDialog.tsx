import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { Icon } from "./icons";

/** 接入资源留在任务上下文，复用现有 Radix 模态与焦点恢复。 */
export function ResourceDialog({ title, open, onOpenChange, children, busy = false }: {
  title: string; open: boolean; onOpenChange: (value: boolean) => void; children: ReactNode; busy?: boolean;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={value => {if (!busy || value) onOpenChange(value);}}>
    <Dialog.Portal><Dialog.Overlay className="model-picker-overlay" />
      <Dialog.Content className="resource-dialog" aria-describedby={undefined}
        onOpenAutoFocus={() => {trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;}}
        onCloseAutoFocus={event => {event.preventDefault();const target = trigger.current?.isConnected ? trigger.current : document.getElementById("main");target?.focus({preventScroll:true});}}
        onEscapeKeyDown={event => {if(busy)event.preventDefault();}}
        onInteractOutside={event => {if(busy)event.preventDefault();}}>
        <header className="model-picker-head"><Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close className="model-picker-close" disabled={busy} aria-label="关闭资源接入"><Icon name="x" /></Dialog.Close>
        </header><div className="resource-dialog-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
