import { Copy, Linkedin } from "lucide-react";
import { sort } from "remeda";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import type { getOutreach } from "@/serverFunctions/outreach";

type Outreach = Awaited<ReturnType<typeof getOutreach>>;
type Contact = Outreach["contacts"][number];
type ProspectStatus = Outreach["prospects"][number]["status"];

const VERIFICATION = {
  valid: { variant: "success", label: "Verified" },
  catch_all: { variant: "warning", label: "Catch-all" },
  unknown: { variant: "secondary", label: "Unknown" },
  invalid: { variant: "destructive", label: "Invalid" },
  unverified: { variant: "secondary", label: "Not checked" },
} as const;

const STATUS = {
  new: { variant: "outline", label: "New" },
  contacts_found: { variant: "success", label: "Emails found" },
  no_contacts: { variant: "secondary", label: "No emails" },
  sent: { variant: "info", label: "Sent" },
  replied: { variant: "soft", label: "Replied" },
  won: { variant: "success", label: "Link won" },
  skipped: { variant: "ghost", label: "Skipped" },
} as const;

export function StatusBadge({ status }: { status: ProspectStatus }) {
  return <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;
}

const fullName = (contact: Contact) =>
  [contact.firstName, contact.lastName].filter(Boolean).join(" ");

/** Named people first, then verified addresses. */
function rank(contacts: Contact[]) {
  // remeda's sort is stable, so ties keep the order found.
  return sort(
    contacts,
    (a, b) =>
      Number(!fullName(a)) - Number(!fullName(b)) ||
      Number(a.verification !== "valid") - Number(b.verification !== "valid"),
  );
}

/** Table cell: the best contact and how many emails were found. */
export function ContactsSummary({
  contacts,
  checked,
}: {
  contacts: Contact[];
  checked: boolean;
}) {
  if (contacts.length === 0)
    return (
      <span className="text-xs text-muted-foreground">
        {checked ? "None found" : "Not checked"}
      </span>
    );
  const [best] = rank(contacts);
  const verified = contacts.filter((c) => c.verification === "valid").length;
  return (
    <div className="min-w-0 text-xs">
      <div className="truncate font-medium text-foreground">
        {fullName(best) || best.email}
      </div>
      <div className="text-muted-foreground">
        {contacts.length} {contacts.length === 1 ? "email" : "emails"}
        {verified ? ` · ${verified} verified` : ""}
      </div>
    </div>
  );
}

/** The emails found for one prospect, shown when its row is expanded. */
export function ContactList({
  contacts,
  checked,
}: {
  contacts: Contact[];
  checked: boolean;
}) {
  if (contacts.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {checked
          ? "No emails found for this site. Remove it, or select it and find emails again later."
          : "No emails yet. Select this prospect and click Find emails."}
      </p>
    );
  return (
    <ul className="divide-y rounded-md border bg-background text-sm">
      {rank(contacts).map((contact) => (
        <li
          key={contact.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
        >
          <div className="min-w-48 flex-1">
            <div className="font-medium">
              {fullName(contact) || (
                <span className="text-muted-foreground">General address</span>
              )}
            </div>
            {contact.title ? (
              <div className="text-xs text-muted-foreground">
                {contact.title}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs">{contact.email}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Copy ${contact.email}`}
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(contact.email);
                toast.success("Email copied.");
              }}
            >
              <Copy className="size-3.5" />
            </Button>
            {contact.linkedinUrl ? (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="LinkedIn profile"
                className="text-muted-foreground hover:text-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                <Linkedin className="size-3.5" />
              </a>
            ) : null}
          </div>
          <Badge variant={VERIFICATION[contact.verification].variant}>
            {VERIFICATION[contact.verification].label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            via {contact.foundVia}
            {contact.sentAt
              ? ` · sent ${new Date(contact.sentAt).toLocaleDateString()}`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
