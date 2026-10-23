import { Badge } from "@/client/components/ui/badge";
import type { getOutreach } from "@/serverFunctions/outreach";

type Contact = Awaited<ReturnType<typeof getOutreach>>["contacts"][number];

const VERIFICATION_VARIANT = {
  valid: "success",
  catch_all: "warning",
  unknown: "secondary",
  invalid: "destructive",
  unverified: "secondary",
} as const;

/** The emails found for one prospect, shown when its row is expanded. */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No contacts yet. Select this prospect and click Find emails.
      </p>
    );
  return (
    <ul className="space-y-1 text-sm">
      {contacts.map((contact) => (
        <li key={contact.id} className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{contact.email}</span>
          <Badge variant={VERIFICATION_VARIANT[contact.verification]} size="sm">
            {contact.verification.replace("_", "-")}
          </Badge>
          <span className="text-muted-foreground">
            {[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
            {contact.title ? ` · ${contact.title}` : ""} · via{" "}
            {contact.foundVia}
            {contact.sentAt
              ? ` · sent ${new Date(contact.sentAt).toLocaleDateString()}`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
