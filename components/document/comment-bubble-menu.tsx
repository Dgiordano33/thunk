"use client";

import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { BoldIcon, CodeIcon, HelpCircleIcon, ItalicIcon, MessageSquarePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CommentKind } from "@/lib/documents/types";

export function CommentBubbleMenu({
  editor,
  onComment,
}: {
  editor: Editor;
  onComment: (kind: CommentKind) => void;
}) {
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor, state }) => editor.isEditable && !state.selection.empty}
      className="bg-popover text-popover-foreground flex items-center gap-0.5 rounded-lg border p-1 shadow-md"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => onComment("change")}>
            <MessageSquarePlusIcon />
            Comment
          </Button>
        </TooltipTrigger>
        <TooltipContent>Comment on selection (⌘⌥M)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => onComment("question")}>
            <HelpCircleIcon />
            Ask
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ask a question about this</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      <Button
        size="icon-sm"
        variant={editor.isActive("bold") ? "secondary" : "ghost"}
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-label="Bold"
      >
        <BoldIcon />
      </Button>
      <Button
        size="icon-sm"
        variant={editor.isActive("italic") ? "secondary" : "ghost"}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Italic"
      >
        <ItalicIcon />
      </Button>
      <Button
        size="icon-sm"
        variant={editor.isActive("code") ? "secondary" : "ghost"}
        onClick={() => editor.chain().focus().toggleCode().run()}
        aria-label="Inline code"
      >
        <CodeIcon />
      </Button>
    </BubbleMenu>
  );
}
