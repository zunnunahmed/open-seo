import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: vi.fn(async (name: string) =>
    name === "CUSTOM_TREG_ENABLED" ? "true" : "treg-token",
  ),
}));

import { findContactsForDomain } from "./contactFinder";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Answer each treg endpoint with a fixed body, recording which were called. */
function stubTreg(bodies: Record<string, unknown>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const endpoint = url.pathname.replace("/call/", "");
      const body = bodies[endpoint];
      // A Response stands for an error answer relayed by treg.
      return body instanceof Response ? body : Response.json(body ?? {});
    });
}

const calledEndpoints = (fetchMock: ReturnType<typeof stubTreg>) =>
  fetchMock.mock.calls.map(([input]) =>
    new URL(typeof input === "string" ? input : "https://x/").pathname.replace(
      "/call/",
      "",
    ),
  );

describe("findContactsForDomain", () => {
  it("finds emails cheapest first, keeps only the prospect's domain and verifies them", async () => {
    const fetchMock = stubTreg({
      "dropleads.people.search": {
        data: {
          leads: [
            {
              first_name: "Jane",
              last_name: "Doe",
              title: "Editor",
              linkedin_url: "https://www.linkedin.com/in/jane",
            },
          ],
        },
      },
      // A stale record at a previous employer must not be pitched.
      "blitzapi.people.email.find": { found: true, email: "jane@oldjob.com" },
      "trykitt.people.email.find": { email: "Jane@Site.com.au" },
      "millionverifier.people.email.verify": { result: "ok" },
    });

    const { contacts } = await findContactsForDomain(
      "www.site.com.au",
      "link",
      new Set(),
    );

    expect(contacts).toEqual([
      expect.objectContaining({
        email: "jane@site.com.au",
        foundVia: "trykitt",
        verification: "valid",
        title: "Editor",
      }),
    ]);
    expect(calledEndpoints(fetchMock)).not.toContain(
      "tomba.companies.emails.list",
    );
  });

  it("keeps an email on another domain when none is found on the site", async () => {
    stubTreg({
      "dropleads.people.search": {
        data: {
          leads: [
            {
              first_name: "Jane",
              last_name: "Doe",
              linkedin_url: "https://www.linkedin.com/in/jane",
            },
          ],
        },
      },
      "blitzapi.people.email.find": { found: true, email: "jane@gmail.com" },
      "trykitt.people.email.find": { email: "no-results-found" },
    });
    const { contacts } = await findContactsForDomain(
      "site.com",
      "link",
      new Set(),
    );
    expect(contacts).toEqual([
      expect.objectContaining({ email: "jane@gmail.com", foundVia: "blitz" }),
    ]);
  });

  it("treats a provider's error answer as a miss and an empty treg balance as fatal", async () => {
    const lead = {
      data: {
        leads: [
          {
            first_name: "Jane",
            last_name: "Doe",
            linkedin_url: "https://www.linkedin.com/in/jane",
          },
        ],
      },
    };
    stubTreg({
      "dropleads.people.search": lead,
      "blitzapi.people.email.find": new Response("not found", { status: 404 }),
      "trykitt.people.email.find": { email: "jane@site.com" },
    });
    const { contacts } = await findContactsForDomain(
      "site.com",
      "link",
      new Set(),
    );
    expect(contacts.map((c) => c.email)).toEqual(["jane@site.com"]);

    vi.restoreAllMocks();
    stubTreg({
      "dropleads.people.search": new Response("no balance", { status: 402 }),
    });
    await expect(
      findContactsForDomain("site.com", "link", new Set()),
    ).rejects.toThrow("treg HTTP 402");
  });

  it("falls back to the domain's listed emails and reports catch-all honestly", async () => {
    stubTreg({
      "dropleads.people.search": { data: { leads: [] } },
      "tomba.companies.emails.list": {
        data: {
          emails: [
            { email: "hello@site.com", type: "generic" },
            { email: "sam@site.com", type: "personal", position: "Founder" },
          ],
        },
      },
      "millionverifier.people.email.verify": { result: "catch_all" },
    });

    const { contacts } = await findContactsForDomain(
      "site.com",
      "link",
      new Set(["hello@site.com"]),
    );

    expect(contacts).toEqual([
      expect.objectContaining({
        email: "sam@site.com",
        foundVia: "tomba",
        verification: "catch_all",
      }),
    ]);
  });
});
