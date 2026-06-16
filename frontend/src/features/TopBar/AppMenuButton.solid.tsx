/** @jsxImportSource solid-js */
import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { appAlert, appConfirm } from "../../components";
import { createStoreSelector } from "../../solid-utils/store";
import { createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { useDocumentStore, useTransportStore, useUiStore } from "../../state/store";
import { BrandMarkSolid } from "./BrandMark.solid";
import styles from "./AppMenuButton.module.css";

export interface AppMenuButtonProps {
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onExportRange?: () => void;
  onExportTrack?: () => void;
  onRecover?: () => void;
  onHealth?: () => void;
  onSettings: () => void;
  disableHome?: boolean;
  disableFileStateActions?: boolean;
}

export interface MountedAppMenuButtonSolid {
  setProps: (props: AppMenuButtonProps) => void;
  dispose: () => void;
}

export function mountAppMenuButtonSolid(host: HTMLElement, initialProps: AppMenuButtonProps): MountedAppMenuButtonSolid {
  const [props, setProps] = createSignal(initialProps, { equals: false });
  const dispose = render(() => <AppMenuButtonSolid props={props} />, host);
  return { setProps, dispose };
}

export function AppMenuButtonSolid(props: { props: Accessor<AppMenuButtonProps> }) {
  let buttonElement: HTMLButtonElement | undefined;
  const dirty = createStoreSelector(useDocumentStore, (state) => state.dirty);
  const documentOpen = createStoreSelector(useDocumentStore, (state) => state.documentOpen);
  const currentFilePath = createStoreSelector(useDocumentStore, (state) => state.currentFilePath);
  const selectedTrackCount = createStoreSelector(useUiStore, (state) => state.selectedTrackIds.length);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);
  const menu = createContextMenu((): ContextMenuItem[] => {
    const callbacks = props.props();
    const disableFileStateActions = callbacks.disableFileStateActions ?? false;
    const hasReviewRange = loopRange().endBeat > loopRange().startBeat;
    return [
      { label: "Home", icon: "ph:house", disabled: callbacks.disableHome, onSelect: callbacks.onHome },
      { label: "What's New", icon: "ph:sparkle", onSelect: () => void appAlert("What's New is coming soon.") },
      { label: "New Project", icon: "ph:plus", separatorBefore: true, onSelect: callbacks.onNew },
      { label: "Open...", icon: "ph:folder-open", onSelect: callbacks.onOpen },
      { label: "Import...", icon: "ph:download-simple", disabled: true, hint: "Later" },
      { label: "Save As...", icon: "ph:floppy-disk-back", disabled: disableFileStateActions, onSelect: callbacks.onSaveAs },
      {
        label: "Save...",
        icon: "ph:floppy-disk",
        disabled: disableFileStateActions,
        hint: documentOpen() && dirty() ? "*" : undefined,
        onSelect: callbacks.onSave,
      },
      {
        label: "Export As...",
        icon: "ph:export",
        disabled: disableFileStateActions,
        submenu: disableFileStateActions ? undefined : [
          { label: "Full Mix WAV", icon: "ph:waveform", onSelect: callbacks.onExport },
          {
            label: "Review Range WAV",
            icon: "ph:arrows-in-line-horizontal",
            disabled: !hasReviewRange || !callbacks.onExportRange,
            hint: hasReviewRange ? undefined : "Set loop",
            onSelect: callbacks.onExportRange,
          },
          {
            label: "Selected Track WAV",
            icon: "ph:git-branch",
            disabled: selectedTrackCount() !== 1 || !callbacks.onExportTrack,
            hint: selectedTrackCount() === 1 ? undefined : "Select 1",
            onSelect: callbacks.onExportTrack,
          },
        ],
      },
      {
        label: "Recover Backup...",
        icon: "ph:clock-counter-clockwise",
        disabled: disableFileStateActions || !currentFilePath() || !callbacks.onRecover,
        onSelect: callbacks.onRecover,
      },
      {
        label: "Project Health",
        icon: "ph:shield-check",
        disabled: disableFileStateActions || !documentOpen() || !callbacks.onHealth,
        onSelect: callbacks.onHealth,
      },
      { label: "Settings", icon: "ph:gear", separatorBefore: true, onSelect: callbacks.onSettings },
      {
        label: "Quit",
        icon: "ph:sign-out",
        onSelect: () => {
          const { documentOpen: isOpen, dirty: isDirty } = useDocumentStore.getState();
          void (async () => {
            if (isOpen && isDirty && !await appConfirm("Quit Beat? Unsaved changes may be lost.")) return;
            window.close();
          })();
        },
      },
    ];
  });

  function openMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = buttonElement?.getBoundingClientRect();
    menu.openAt(rect?.left ?? event.clientX, (rect?.bottom ?? event.clientY) + 1);
  }

  return (
    <>
      <button
        ref={buttonElement}
        type="button"
        class={styles.menuButton}
        onClick={openMenu}
        onContextMenu={menu.onContextMenu}
        aria-label="Beat menu"
        aria-haspopup="menu"
      >
        <BrandMarkSolid />
      </button>
      {menu.menu()}
    </>
  );
}
