import { type Accessor } from "solid-js";
import { AppLogo, appAlert, appConfirm, RailButton } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { useExportStore } from "../../state/exportStore";
import { useDocumentStore, useTransportStore, useUiStore } from "../../state/store";
import styles from "./AppMenuButton.module.css";

export interface AppMenuButtonProps {
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onExportReview?: () => void;
  onExportRange?: () => void;
  onExportTrack?: () => void;
  onRecover?: () => void;
  onHealth?: () => void;
  onUserGuide: () => void;
  onSettings: () => void;
  disableHome?: boolean;
  disableFileStateActions?: boolean;
}

export function AppMenuButton(props: { props: Accessor<AppMenuButtonProps> }) {
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
      { label: "User Guide", icon: "ph:folder-open", onSelect: callbacks.onUserGuide },
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
        label: "Export...",
        icon: "ph:export",
        disabled: disableFileStateActions,
        submenu: disableFileStateActions ? undefined : [
          {
            label: "Review & Export",
            icon: "ph:sliders-horizontal",
            onSelect: callbacks.onExportReview ?? callbacks.onExport,
          },
          {
            label: "Full Mix WAV",
            icon: "ph:waveform",
            separatorBefore: true,
            onSelect: () => {
              useExportStore.getState().setSelectedPresetId("full-mix-review");
              (callbacks.onExportReview ?? callbacks.onExport)();
            },
          },
          {
            label: "Review Range WAV",
            icon: "ph:arrows-in-line-horizontal",
            disabled: !hasReviewRange || !callbacks.onExportRange,
            hint: hasReviewRange ? undefined : "Set loop",
            onSelect: () => {
              useExportStore.getState().setSelectedPresetId("review-range");
              (callbacks.onExportReview ?? callbacks.onExportRange)?.();
            },
          },
          {
            label: "Selected Track WAV",
            icon: "ph:git-branch",
            disabled: selectedTrackCount() !== 1 || !callbacks.onExportTrack,
            hint: selectedTrackCount() === 1 ? undefined : "Select 1",
            onSelect: () => {
              useExportStore.getState().setSelectedPresetId("selected-stem");
              (callbacks.onExportReview ?? callbacks.onExportTrack)?.();
            },
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
      <RailButton
        ref={buttonElement}
        class={styles.menuButton}
        onClick={openMenu}
        onContextMenu={menu.onContextMenu}
        aria-label="Beat menu"
        aria-haspopup="menu"
      >
        <AppLogo class={styles.menuLogo} />
      </RailButton>
      {menu.menu()}
    </>
  );
}
