"use client";

import type { MessageAttachment } from "@roster/api";
import { Button, cn } from "@roster/ui";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { SendHorizonal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAttachments } from "~/hooks/use-attachments";
import {
  ACCEPT_ATTRIBUTE,
  filesFromTransfer,
  transferHasFiles,
} from "~/utils/attachments";
import { submitsOnEnter } from "~/utils/composer-keys";
import { clearDraft, draftKey, readDraft, writeDraft } from "~/utils/draft-store";
import { isEmojiSuggestionOpen } from "~/utils/emoji-suggestion";
import { isMentionSuggestionOpen } from "~/utils/mention-suggestion";
import type { MentionItem } from "~/utils/mentions";
import { composerExtensions } from "~/utils/tiptap-extensions";
import { trpc } from "~/utils/trpc";

import { AttachmentTray } from "./attachment-tray";
import { ComposerToolbar } from "./composer-toolbar";

export interface ComposerSendPayload {
  body: unknown;
  text: string;
  attachmentIds: string[];
  attachments: MessageAttachment[];
}

export interface ComposerProps {
  placeholder: string;
  projectId: string;
  threadId?: string;
  onSend: (payload: ComposerSendPayload) => void;
}

const DRAFT_SAVE_MS = 300;

function isTouchKeyboard() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function Composer({
  placeholder,
  projectId,
  threadId,
  onSend,
}: ComposerProps) {
  const sendRef = useRef(onSend);
  sendRef.current = onSend;

  const key = useMemo(
    () => draftKey({ projectId, threadId }),
    [projectId, threadId],
  );

  const savedKey = useRef(key);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDoc = useRef<unknown>(null);

  const cancelSave = useCallback(() => {
    if (saveTimer.current === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  const flushDraft = useCallback(() => {
    cancelSave();
    if (latestDoc.current !== null) writeDraft(savedKey.current, latestDoc.current);
  }, [cancelSave]);

  const scheduleSave = useCallback(
    (doc: unknown) => {
      latestDoc.current = doc;
      cancelSave();
      const target = savedKey.current;
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        writeDraft(target, doc);
      }, DRAFT_SAVE_MS);
    },
    [cancelSave],
  );

  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);

  const attachments = useAttachments(projectId);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const mentionsRef = useRef<MentionItem[]>([]);
  const getMentions = useMemo(() => () => mentionsRef.current, []);

  useEffect(() => {
    let live = true;
    void trpc.channels.mentionable
      .query()
      .then((items) => {
        if (live) mentionsRef.current = items;
      })
      .catch(() => {
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = useCallback(
    (instance: Editor) => {
      const text = instance.getText().trim();
      const tray = attachmentsRef.current;

      if (text.length === 0 && tray.attachmentIds.length === 0) return false;
      if (tray.uploading) return false;

      sendRef.current({
        body: instance.getJSON(),
        text,
        attachmentIds: tray.attachmentIds,
        attachments: tray.attachments,
      });
      tray.clear();

      cancelSave();
      latestDoc.current = null;
      clearDraft(savedKey.current);

      queueMicrotask(() => {
        instance.chain().focus().clearContent(true).unsetAllMarks().run();
      });
      return true;
    },
    [cancelSave],
  );

  const editor = useEditor({
    extensions: composerExtensions(placeholder, getMentions),
    immediatelyRender: false,
    autofocus: isTouchKeyboard() ? false : "end",
    content: readDraft(key) ?? undefined,
    onUpdate: ({ editor: instance }) => scheduleSave(instance.getJSON()),
    editorProps: {
      attributes: {
        class: "tiptap max-w-full focus:outline-none",
      },
      handleKeyDown(view, event) {
        const send = submitsOnEnter(event, {
          suggestionOpen:
            isMentionSuggestionOpen(view.state) ||
            isEmojiSuggestionOpen(editorRef.current),
          touchKeyboard: isTouchKeyboard(),
        });
        if (!send || !editorRef.current) return false;
        event.preventDefault();
        submit(editorRef.current);
        return true;
      },
      handlePaste(_view, event) {
        const files = filesFromTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        attachmentsRef.current.addFiles(files);
        return true;
      },
      handleDrop(_view, event) {
        const transfer = (event as DragEvent).dataTransfer;
        const files = filesFromTransfer(transfer);
        if (files.length === 0) return false;
        event.preventDefault();
        attachmentsRef.current.addFiles(files);
        return true;
      },
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor || savedKey.current === key) return;

    flushDraft();
    savedKey.current = key;
    latestDoc.current = null;
    editor.commands.setContent(readDraft(key) ?? "", { emitUpdate: false });
  }, [editor, key, flushDraft]);

  useEffect(() => flushDraft, [flushDraft]);

  if (!editor) {
    return (
      <div className="bg-background-3 border-border h-28 rounded-xl border" />
    );
  }

  const blocked = attachments.uploading;

  return (
    <div
      className={cn(
        "bg-background-3 border-border relative flex flex-col rounded-xl border",
        draggingOver && "border-primary",
      )}
      onDragOver={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setDraggingOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDraggingOver(false);
      }}
      onDrop={(event) => {
        setDraggingOver(false);
        if (!transferHasFiles(event.dataTransfer)) return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        attachments.addFiles(filesFromTransfer(event.dataTransfer));
      }}
    >
      {draggingOver ? (
        <div className="bg-background-3/85 text-muted-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl text-sm">
          Drop to attach
        </div>
      ) : null}

      <ComposerToolbar
        editor={editor}
        onAttach={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(event) => {
          attachments.addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
          editor.commands.focus();
        }}
      />

      <EditorContent
        editor={editor}
        className="editor-container max-h-60 overflow-y-auto px-3 py-2"
      />

      <AttachmentTray
        items={attachments.items}
        error={attachments.error}
        onRemove={attachments.remove}
      />

      <div className="flex items-center justify-end gap-2 px-2 pt-1 pb-2">
        <span className="text-muted-foreground mr-auto hidden px-1 text-xs sm:inline">
          {blocked
            ? "Uploading…"
            : "Enter to send · Shift+Enter for a new line"}
        </span>
        <Button
          size="sm"
          aria-label="Send message"
          disabled={blocked}
          onClick={() => submit(editor)}
        >
          <SendHorizonal size={14} />
        </Button>
      </div>
    </div>
  );
}
