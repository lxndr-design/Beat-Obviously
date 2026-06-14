import { useRef, type MouseEvent } from "react";
import { appAlert, appConfirm, useContextMenu, type ContextMenuItem } from "../../components";
import { useDocumentStore, useTransportStore, useUiStore } from "../../state/store";
import { BrandMark } from "./BrandMark";
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

export function AppMenuButton({
  onHome,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExport,
  onExportRange,
  onExportTrack,
  onRecover,
  onHealth,
  onSettings,
  disableHome = false,
  disableFileStateActions = false,
}: AppMenuButtonProps) {
  const dirty = useDocumentStore((s) => s.dirty);
  const documentOpen = useDocumentStore((s) => s.documentOpen);
  const currentFilePath = useDocumentStore((s) => s.currentFilePath);
  const selectedTrackCount = useUiStore((s) => s.selectedTrackIds.length);
  const loopRange = useTransportStore((s) => s.loopRange);
  const hasUnsavedDocument = documentOpen && dirty;
  const hasReviewRange = loopRange.endBeat > loopRange.startBeat;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menu = useContextMenu((): ContextMenuItem[] => [
    { label: "Home", icon: "ph:house", disabled: disableHome, onSelect: onHome },
    { label: "What's New", icon: "ph:sparkle", onSelect: () => void appAlert("What's New is coming soon.") },
    { label: "New Project", icon: "ph:plus", separatorBefore: true, onSelect: onNew },
    { label: "Open...", icon: "ph:folder-open", onSelect: onOpen },
    { label: "Import...", icon: "ph:download-simple", disabled: true, hint: "Later" },
    { label: "Save As...", icon: "ph:floppy-disk-back", disabled: disableFileStateActions, onSelect: onSaveAs },
    {
      label: "Save...",
      icon: "ph:floppy-disk",
      disabled: disableFileStateActions,
      hint: hasUnsavedDocument ? "*" : undefined,
      onSelect: onSave,
    },
    {
      label: "Export As...",
      icon: "ph:export",
      disabled: disableFileStateActions,
      submenu: disableFileStateActions ? undefined : [
        { label: "Full Mix WAV", icon: "ph:waveform", onSelect: onExport },
        {
          label: "Review Range WAV",
          icon: "ph:arrows-in-line-horizontal",
          disabled: !hasReviewRange || !onExportRange,
          hint: hasReviewRange ? undefined : "Set loop",
          onSelect: onExportRange,
        },
        {
          label: "Selected Track WAV",
          icon: "ph:git-branch",
          disabled: selectedTrackCount !== 1 || !onExportTrack,
          hint: selectedTrackCount === 1 ? undefined : "Select 1",
          onSelect: onExportTrack,
        },
      ],
    },
    {
      label: "Recover Backup...",
      icon: "ph:clock-counter-clockwise",
      disabled: disableFileStateActions || !currentFilePath || !onRecover,
      onSelect: onRecover,
    },
    {
      label: "Project Health",
      icon: "ph:shield-check",
      disabled: disableFileStateActions || !documentOpen || !onHealth,
      onSelect: onHealth,
    },
    { label: "Settings", icon: "ph:gear", separatorBefore: true, onSelect: onSettings },
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
  ]);

  function openMenu(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const rect = buttonRef.current?.getBoundingClientRect();
    menu.openAt(rect?.left ?? e.clientX, (rect?.bottom ?? e.clientY) + 1);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        onClick={openMenu}
        onContextMenu={menu.onContextMenu}
        aria-label="Beat menu"
        aria-haspopup="menu"
      >
        <BrandMark />
      </button>
      {menu.menu}
    </>
  );
}
