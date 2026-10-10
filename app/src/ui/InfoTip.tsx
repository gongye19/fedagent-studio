import * as Tooltip from "@radix-ui/react-tooltip";
import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

/** 解释浮在字段旁，不改变表单高度；点击可固定，支持触屏和键盘。 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setPinned(false); setOpen(false); };
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root open={open} onOpenChange={(next) => { if (!pinned) setOpen(next); }}>
        <Tooltip.Trigger asChild>
          <button ref={trigger} type="button" className="info-tip-trigger" aria-label={`${label}说明`} aria-expanded={open}
            onClick={(event) => { event.preventDefault(); setPinned(!pinned); setOpen(!pinned); }} onBlur={close}>
            <Icon name="info" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="info-tip" side="top" align="start" sideOffset={6} collisionPadding={12}
            onEscapeKeyDown={close} onPointerDownOutside={(event) => {
              // Portal 中的浮层把触发器也视为外部；交给按钮本身切换，避免先关后开。
              if (trigger.current?.contains(event.detail.originalEvent.target as Node)) event.preventDefault();
              else close();
            }}>
            {children}
            <Tooltip.Arrow className="info-tip-arrow" width={10} height={5} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
