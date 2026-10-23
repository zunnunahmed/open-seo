import { Check, Plus } from "lucide-react";
import { Button } from "@/client/components/ui/button";

export type ProspectCandidate = {
  domain: string;
  sourceUrl?: string | null;
  authority?: number | null;
};

/** What a table needs to add rows to Link Prospects (see useAddToProspects). */
export type AddToProspects = {
  add: (candidates: ProspectCandidate[]) => Promise<void>;
  isListed: (domain: string) => boolean;
  isPending: (domain: string) => boolean;
};

/** Row button: adds one site, then shows it is listed. */
export function AddProspectButton({
  prospects,
  candidate,
}: {
  prospects: AddToProspects;
  candidate: ProspectCandidate;
}) {
  const listed = prospects.isListed(candidate.domain);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={listed || prospects.isPending(candidate.domain)}
      aria-label={
        listed
          ? `${candidate.domain} is in Link Prospects`
          : `Add ${candidate.domain} to Link Prospects`
      }
      title={listed ? "In Link Prospects" : "Add to Link Prospects"}
      onClick={(event) => {
        event.stopPropagation();
        void prospects.add([candidate]);
      }}
    >
      {listed ? <Check className="text-success" /> : <Plus />}
    </Button>
  );
}
