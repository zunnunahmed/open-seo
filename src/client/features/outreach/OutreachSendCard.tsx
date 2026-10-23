import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  getInstantlyCampaigns,
  sendOutreachToInstantly,
} from "@/serverFunctions/outreach";

/**
 * Step 3: add verified contacts of the selected prospects to an Instantly
 * campaign. Instantly sends the emails; the campaign (copy, sequence,
 * sending accounts) is built there.
 */
export function OutreachSendCard({
  projectId,
  contactIds,
  onSent,
}: {
  projectId: string;
  /** Unsent contacts of the selected prospects. */
  contactIds: string[];
  onSent: () => void;
}) {
  const campaigns = useQuery({
    queryKey: ["instantly-campaigns", projectId],
    queryFn: () => getInstantlyCampaigns({ data: { projectId } }),
  });
  const [campaignId, setCampaignId] = useState("");
  const [includeCatchAll, setIncludeCatchAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setSending(true);
    setError("");
    try {
      const result = await sendOutreachToInstantly({
        data: {
          projectId,
          campaignId,
          contactIds: contactIds.slice(0, 500),
          includeCatchAll,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        `${result.uploaded} leads added to Instantly${result.skipped ? `, ${result.skipped} skipped (already in Instantly, blocklisted or invalid)` : ""}.`,
      );
      onSent();
    } finally {
      setSending(false);
    }
  }

  const list = campaigns.data?.ok ? campaigns.data.campaigns : [];
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">3. Send to Instantly.ai</h2>
      <p className="text-sm text-muted-foreground">
        Build the campaign (email copy, sequence, sending accounts) in
        Instantly, then pick it here. Only verified emails are sent, never
        twice. Use these variables in your copy: <code>{"{{firstName}}"}</code>,{" "}
        <code>{"{{companyName}}"}</code> (the website),{" "}
        <code>{"{{prospect_detail}}"}</code> (competitor, search or topic),{" "}
        <code>{"{{prospect_title}}"}</code> and{" "}
        <code>{"{{prospect_url}}"}</code> (the page or article that surfaced
        them).
      </p>
      {campaigns.data && !campaigns.data.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {campaigns.data.error}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            aria-label="Instantly campaign"
          >
            <option value="">
              {campaigns.isPending ? "Loading campaigns…" : "Choose a campaign"}
            </option>
            {list.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name} ({campaign.status})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeCatchAll}
              onCheckedChange={(checked) => setIncludeCatchAll(checked)}
            />
            Include catch-all emails (higher bounce risk)
          </label>
          <Button
            disabled={!campaignId || contactIds.length === 0 || sending}
            onClick={() => void send()}
          >
            {sending
              ? "Sending…"
              : `Send contacts of selected prospects (${contactIds.length})`}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
