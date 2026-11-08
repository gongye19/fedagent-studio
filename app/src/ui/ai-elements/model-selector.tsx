// Adapted from Vercel AI Elements (Apache-2.0), model-selector.tsx at
// 6a9d5b1822ffb10bba4bd97175f01edd7d8651cd. See LICENSE beside this file.
// Copyright 2023 Vercel, Inc. Modified for FedAgent Studio, 2026-10-10.
// Preserve the composable ModelSelector API; use project CSS, Radix Dialog and cmdk directly.
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "../icons";

export const ModelSelector = (props: ComponentProps<typeof Dialog.Root>) => <Dialog.Root {...props} />;
export const ModelSelectorTrigger = (props: ComponentProps<typeof Dialog.Trigger>) => <Dialog.Trigger {...props} />;
export function ModelSelectorContent({ children, title = "选择模型", closeLabel = "关闭模型选择", className, ...props }:
  ComponentProps<typeof Dialog.Content> & { title?: ReactNode; closeLabel?: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="model-picker-overlay" />
      <Dialog.Content {...props} aria-describedby={undefined} className={`model-picker${className ? ` ${className}` : ""}`}>
        <div className="model-picker-head">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close className="model-picker-close" aria-label={closeLabel}><Icon name="x" /></Dialog.Close>
        </div>
        <Command>{children}</Command>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
export const ModelSelectorInput = (props: ComponentProps<typeof Command.Input>) => <Command.Input {...props} />;
export const ModelSelectorList = (props: ComponentProps<typeof Command.List>) => <Command.List {...props} />;
export const ModelSelectorEmpty = (props: ComponentProps<typeof Command.Empty>) => <Command.Empty {...props} />;
export const ModelSelectorGroup = (props: ComponentProps<typeof Command.Group>) => <Command.Group {...props} />;
export const ModelSelectorItem = (props: ComponentProps<typeof Command.Item>) => <Command.Item {...props} />;
export const ModelSelectorName = ({ className, ...props }: ComponentProps<"span">) => <span {...props} className={`model-picker-name${className ? ` ${className}` : ""}`} />;
