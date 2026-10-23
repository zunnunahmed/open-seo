import { Ban, ChevronDown, Mail, Trash2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

export type MarkableStatus = "new" | "replied" | "won" | "skipped";

const MARKS: Array<{ status: MarkableStatus; label: string }> = [
  { status: "replied", label: "Replied" },
  { status: "won", label: "Link won" },
  { status: "skipped", label: "Skipped" },
  { status: "new", label: "New (reset)" },
];

/** Actions for the selected prospects, shown in the table toolbar. */
export function OutreachActions({
  findable,
  finding,
  onFind,
  onStop,
  onMark,
  onRemove,
  onDoNotContact,
}: {
  /** Selected prospects without emails yet. */
  findable: number;
  finding: { done: number; total: number } | null;
  onFind: () => void;
  onStop: () => void;
  onMark: (status: MarkableStatus) => void;
  onRemove: () => void;
  onDoNotContact: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        disabled={finding !== null || findable === 0}
        title={
          findable === 0
            ? "The selected prospects already have emails."
            : "About US$0.01 per site. Sites with no emails found are free."
        }
        onClick={onFind}
      >
        <Mail className="size-4" />
        {finding
          ? `Finding emails… ${finding.done}/${finding.total}`
          : `Find emails (${findable})`}
      </Button>
      {finding ? (
        <Button size="sm" variant="ghost" onClick={onStop}>
          Stop
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" variant="outline" className="gap-1" />}
        >
          Mark as
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-40">
          {MARKS.map((mark) => (
            <DropdownMenuItem
              key={mark.status}
              onClick={() => onMark(mark.status)}
            >
              {mark.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="outline"
        title="Delete from this list. The site can be found again later."
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
        Remove
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        title="Remove and never add this site again."
        onClick={onDoNotContact}
      >
        <Ban className="size-4" />
        Do not contact
      </Button>
    </div>
  );
}
