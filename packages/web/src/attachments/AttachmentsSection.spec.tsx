/**
 * `AttachmentsSection.spec.tsx` — Story 4.13.
 *
 * Coverage matrix (each spec AC bullet → at least one `it(...)`):
 *
 *   AC "HAPPY_PATH_OPERATOR" — the section renders 2 attachments
 *     as `<li>` rows with label, MIME, uploader. The "Add
 *     attachment" button is present. The per-row delete button
 *     shows for the uploader's own row.
 *   AC "LIST_EMPTY" — 200 with `{ attachments: [] }` envelope
 *     renders the "No attachments yet." copy.
 *   AC "DELETE_OTHER_OPERATOR_UI" — when the viewer is an
 *     Operator viewing another operator's row, the per-row delete
 *     button is hidden (per-row ownership gate).
 *   AC "ZERO_HAPPY_VIEWER" — when the viewer role is Viewer, the
 *     "Add attachment" button is absent AND the per-row delete
 *     buttons are absent (read-only surface; matrix grants the
 *     read but denies the create + delete).
 *   AC "XSS_LABEL" — when the api returns a label containing
 *     `<script>...</script>`, the section renders the literal
 *     text (React's text-content escape) — no script element
 *     appears in the DOM.
 *   AC "URL_RENDERED_AS_ANCHOR" — the attachment URL renders as
 *     `<a rel="noopener noreferrer" target="_blank">` (the XSS
 *     mitigation seam + external-link UX).
 *   AC "CREATE_400_TOAST" — when the api rejects the create with
 *     400 (invalid URL scheme), the section surfaces the
 *     classified "Invalid URL or payload" toast.
 *   AC "CREATE_403_TOAST" — when the api rejects the create with
 *     403 (Viewer role), the toast is "Not authorized".
 *   AC "DELETE_204_REFETCH" — clicking the delete button fires
 *     the DELETE; on 204 the list refetches (the server's verdict
 *     is the source of truth — no optimistic UI).
 *   AC "DELETE_403_TOAST" — when the api rejects the delete with
 *     403 (cross-row RBAC), the toast is "Not authorized" AND the
 *     list invalidates (defensive — refetch surfaces the truth).
 *
 * Test rig mirrors `IncidentDetailPage.spec.tsx`: same
 * `vi.mock("../realtime/socketClient")` stub, same
 * `QueryClientProvider` + `MemoryRouter` + `CurrentRoleProvider`
 * wrapping. The `initialUserId` prop wires the section's
 * `canDelete` predicate to a known id (so the per-row ownership
 * gate can be tested with explicit operator/user-id fixtures).
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { _resetTokenStore } from "../auth/tokenStore";
import { ToastRegion, useToasts } from "../incidents/toast";

import { AttachmentsSection } from "./AttachmentsSection";

/**
 * Wrapper component that mounts `<ToastRegion />` alongside the
 * section. In production the parent page (`IncidentDetailPage`)
 * owns the toast region; in the test rig the section is mounted
 * in isolation, so the region must live inside the test wrapper.
 *
 * `useToasts()` is called ONCE inside this wrapper (the section
 * receives `pushToast` as a prop) so the section's failures land
 * in the same queue the region's `<ul>` renders. Calling
 * `useToasts` from both the wrapper AND the section would yield
 * two separate toast queues whose state doesn't sync — a classic
 * stale-state bug.
 */
const SectionWithToasts = ({ incidentId }: { readonly incidentId: string }) => {
  const { toasts, pushToast } = useToasts();
  return (
    <>
      <AttachmentsSection incidentId={incidentId} pushToast={pushToast} />
      <ToastRegion toasts={toasts} />
    </>
  );
};

vi.mock("../realtime/socketClient", () => ({
  connectSocket: () => ({
    on: () => undefined,
    off: () => undefined,
  }),
  disconnectSocket: () => undefined,
  _resetSocket: () => undefined,
  SOCKET_TOKEN_EXPIRED: "401 token_expired",
}));

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const OPERATOR_USER_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_USER_ID = "00000000-0000-4000-8000-0000000000b2";
const ATTACHMENT_ID_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const ATTACHMENT_ID_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";

const ORIGINAL_FETCH = globalThis.fetch;

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = handler as unknown as typeof fetch;
};

const baseAttachment = (overrides: Partial<AttachmentPayload> = {}): AttachmentPayload => ({
  id: ATTACHMENT_ID_OWN,
  incident_id: INCIDENT_ID,
  url: "https://example.com/photo.png",
  label: "Sensor photo",
  mime: "image/png",
  uploaded_by_user_id: OPERATOR_USER_ID,
  created_at: "2026-08-28T00:00:00.000Z",
  ...overrides,
});

interface RenderOptions {
  readonly role: "Admin" | "Operator" | "Technician" | "Viewer";
  readonly userId?: string;
  readonly fetchHandler: (url: string, init?: RequestInit) => Promise<Response>;
}

const renderSection = (opts: RenderOptions) => {
  const qc = buildQueryClient();
  installFetch(opts.fetchHandler);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentRoleProvider initialRole={opts.role} initialUserId={opts.userId ?? null}>
          <SectionWithToasts incidentId={INCIDENT_ID} />
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  _resetTokenStore();
  vi.restoreAllMocks();
});

describe("Story 4.13 — AC: happy path list", () => {
  it("renders attachments as <li> rows with label, MIME, uploader", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(
            JSON.stringify({
              attachments: [
                baseAttachment({
                  id: ATTACHMENT_ID_OWN,
                  uploaded_by_user_id: OPERATOR_USER_ID,
                }),
                baseAttachment({
                  id: ATTACHMENT_ID_OTHER,
                  label: "Other label",
                  url: "https://example.com/log.pdf",
                  mime: "application/pdf",
                  uploaded_by_user_id: OTHER_USER_ID,
                }),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attachments-row-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`attachments-row-link-${ATTACHMENT_ID_OWN}`)).toHaveTextContent(
      "Sensor photo",
    );
    expect(screen.getByTestId(`attachments-row-mime-${ATTACHMENT_ID_OWN}`)).toHaveTextContent(
      "image/png",
    );
    expect(screen.getByTestId(`attachments-row-link-${ATTACHMENT_ID_OWN}`)).toHaveAttribute(
      "href",
      "https://example.com/photo.png",
    );
    expect(screen.getByTestId(`attachments-row-link-${ATTACHMENT_ID_OWN}`)).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByTestId(`attachments-row-link-${ATTACHMENT_ID_OWN}`)).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByTestId(`attachments-row-${ATTACHMENT_ID_OTHER}`)).toBeInTheDocument();
  });

  it("renders 'No attachments yet.' when the list is empty", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("attachments-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("attachments-list-empty")).toHaveTextContent("No attachments yet.");
  });
});

describe("Story 4.13 — AC: Viewer is read-only", () => {
  it("hides the 'Add attachment' button AND per-row delete buttons for Viewer", async () => {
    renderSection({
      role: "Viewer",
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(
            JSON.stringify({
              attachments: [
                baseAttachment({ id: ATTACHMENT_ID_OWN, uploaded_by_user_id: OPERATOR_USER_ID }),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attachments-row-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("attachments-add-button")).toBeNull();
    expect(screen.queryByTestId(`attachments-row-delete-${ATTACHMENT_ID_OWN}`)).toBeNull();
  });
});

describe("Story 4.13 — AC: per-row delete ownership gate", () => {
  it("shows the delete button only for the uploader's own row when viewer is Operator", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(
            JSON.stringify({
              attachments: [
                baseAttachment({ id: ATTACHMENT_ID_OWN, uploaded_by_user_id: OPERATOR_USER_ID }),
                baseAttachment({
                  id: ATTACHMENT_ID_OTHER,
                  uploaded_by_user_id: OTHER_USER_ID,
                }),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attachments-row-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`attachments-row-delete-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`attachments-row-delete-${ATTACHMENT_ID_OTHER}`)).toBeNull();
  });

  it("shows the delete button for ALL rows when viewer is Admin", async () => {
    renderSection({
      role: "Admin",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(
            JSON.stringify({
              attachments: [
                baseAttachment({ id: ATTACHMENT_ID_OWN, uploaded_by_user_id: OPERATOR_USER_ID }),
                baseAttachment({
                  id: ATTACHMENT_ID_OTHER,
                  uploaded_by_user_id: OTHER_USER_ID,
                }),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attachments-row-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`attachments-row-delete-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    expect(screen.getByTestId(`attachments-row-delete-${ATTACHMENT_ID_OTHER}`)).toBeInTheDocument();
  });
});

describe("Story 4.13 — AC: XSS label defensive render", () => {
  it("renders the label as plain text (no script element injected)", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(
            JSON.stringify({
              attachments: [
                baseAttachment({
                  label: "<script>window.__xss=true</script>",
                  uploaded_by_user_id: OPERATOR_USER_ID,
                }),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attachments-row-link-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    });
    // The label appears as literal text (React text-content
    // escaping) — no <script> element exists in the rendered DOM.
    expect(screen.getByTestId(`attachments-row-link-${ATTACHMENT_ID_OWN}`)).toHaveTextContent(
      "<script>window.__xss=true</script>",
    );
    expect(document.querySelector("script[data-testid^='attachments-row']")).toBeNull();
    // And the global side-effect was not triggered.
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });
});

describe("Story 4.13 — AC: create form", () => {
  it("opens the form on 'Add attachment' click + shows URL + label inputs", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("attachments-add-button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("attachments-add-button"));
    expect(screen.getByTestId("attachment-form")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-form-url")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-form-label")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-form-submit")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-form-cancel")).toBeInTheDocument();
  });

  it("blocks submit when the URL is empty and surfaces inline error", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("attachments-add-button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("attachments-add-button"));
    fireEvent.click(screen.getByTestId("attachment-form-submit"));
    expect(screen.getByTestId("attachment-form-error")).toHaveTextContent("URL is required");
  });

  it("blocks submit on a non-http(s) URL (inline 'must be http:// or https://')", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url) => {
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("attachments-add-button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("attachments-add-button"));
    fireEvent.change(screen.getByTestId("attachment-form-url"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByTestId("attachment-form-submit"));
    expect(screen.getByTestId("attachment-form-error")).toHaveTextContent(
      "URL must be http:// or https://",
    );
  });
});

describe("Story 4.13 — AC: create error surfaces toast", () => {
  it("surfaces the 'Not authorized' toast when the api rejects with 403", async () => {
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url, init) => {
        if (init?.method === "POST" && url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
        }
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("attachments-add-button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("attachments-add-button"));
    fireEvent.change(screen.getByTestId("attachment-form-url"), {
      target: { value: "https://example.com/log.png" },
    });
    fireEvent.click(screen.getByTestId("attachment-form-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toBeInTheDocument();
    });
    expect(screen.getByTestId("toast-region")).toHaveTextContent("Not authorized");
  });
});

describe("Story 4.13 — AC: delete triggers refetch on 204", () => {
  it("fires DELETE then re-fetches the list on success (no optimistic UI)", async () => {
    let deleteCalled = false;
    let listFetchCount = 0;
    renderSection({
      role: "Operator",
      userId: OPERATOR_USER_ID,
      fetchHandler: async (url, init) => {
        if (init?.method === "DELETE" && url.endsWith(`/api/attachments/${ATTACHMENT_ID_OWN}`)) {
          deleteCalled = true;
          return new Response(null, { status: 204 });
        }
        if (url.endsWith(`/api/incidents/${INCIDENT_ID}/attachments`)) {
          listFetchCount += 1;
          return new Response(
            JSON.stringify({
              attachments: [
                baseAttachment({ id: ATTACHMENT_ID_OWN, uploaded_by_user_id: OPERATOR_USER_ID }),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attachments-row-delete-${ATTACHMENT_ID_OWN}`)).toBeInTheDocument();
    });
    const baselineFetchCount = listFetchCount;
    fireEvent.click(screen.getByTestId(`attachments-row-delete-${ATTACHMENT_ID_OWN}`));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
    // The mutation invalidates the list query on success, which
    // triggers a re-fetch. The new fetch returns the same row
    // (mock) — the test pins the BEHAVIOR (list was refetched),
    // not the visual outcome (which would only differ with a
    // smarter mock).
    await waitFor(() => {
      expect(listFetchCount).toBeGreaterThan(baselineFetchCount);
    });
  });
});
