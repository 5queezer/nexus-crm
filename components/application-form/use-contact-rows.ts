import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Contact } from "@/types";
import {
  contactToRow,
  createContact,
  updateContact,
  deleteContact,
  type ContactFormRow,
} from "./form-data";

/**
 * Fold a refreshed server list into the rows on screen.
 *
 * Server wins for every row the user has not touched, and the user wins for
 * every row they have: an unsaved edit is not something a background refresh
 * may discard, including one whose contact the agent deleted — that row stays
 * so the person can see what became of their edit rather than watching it
 * vanish. Rows keep their `clientId`, because in-flight updaters target it.
 */
function mergeContactRows(
  local: ContactFormRow[],
  server: Contact[],
): ContactFormRow[] {
  const dirtyById = new Map<string, ContactFormRow>();
  const unsaved: ContactFormRow[] = [];
  for (const row of local) {
    if (!row.isDirty) continue;
    if (row.id) dirtyById.set(row.id, row);
    else unsaved.push(row);
  }
  const localById = new Map(
    local.filter((row) => row.id).map((row) => [row.id as string, row] as const),
  );
  const merged = server.map((contact) => {
    const dirty = dirtyById.get(contact.id);
    if (dirty) return dirty;
    const existing = localById.get(contact.id);
    const row = contactToRow(contact);
    return existing ? { ...row, clientId: existing.clientId } : row;
  });
  const serverIds = new Set(server.map((contact) => contact.id));
  const orphanedEdits = [...dirtyById.values()].filter(
    (row) => !serverIds.has(row.id as string),
  );
  return [...merged, ...orphanedEdits, ...unsaved];
}

/**
 * Contact row state for the application form. In create mode
 * (`applicationId === null`) rows are buffered locally and flushed with
 * `persistPending` once the application exists; otherwise rows are
 * created/updated/deleted inline against the API.
 */
/**
 * A stable digest of the server's contact list.
 *
 * The list is its own revision, deliberately. Keying adoption to the parent
 * application's `updatedAt` looked right and did nothing: no backend touches
 * the application row when a contact is created, updated or deleted, so a run
 * that only changed a contact left the timestamp identical and the refreshed
 * list was never adopted. Sorted by id, so a reordered response is not mistaken
 * for a changed one.
 */
function contactsRevision(contacts: Contact[]): string {
  return contacts
    .map((contact) =>
      [contact.id, contact.name, contact.email, contact.role, contact.linkedIn].join("\u0000"),
    )
    .sort()
    .join("\u0001");
}

export function useContactRows(
  applicationId: string | null,
  initialContacts: Contact[] | undefined,
) {
  const queryClient = useQueryClient();
  const t = useTranslations("modal");
  const [contacts, setContacts] = useState<ContactFormRow[]>(() =>
    (initialContacts ?? []).map(contactToRow),
  );
  const [savingContactIdx, setSavingContactIdx] = useState<number | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(
    null,
  );
  const [contactError, setContactError] = useState<string | null>(null);
  const serverContacts = initialContacts ?? [];
  const revision = contactsRevision(serverContacts);
  const [syncedRevision, setSyncedRevision] = useState(revision);

  // Rows were read from a `useState` initializer and never again, so a Career
  // Ops run that added or changed a contact left the page on the pre-run list:
  // the new contact was invisible, and saving a stale row overwrote what the
  // agent had just written.
  //
  // Not while a row's own write is in flight: that request targets a row by
  // `clientId` and reports by index, and reshuffling underneath it would make
  // the progress indicator describe a different row. The revision stays
  // unadopted, so this runs again once the write settles.
  if (revision !== syncedRevision && savingContactIdx === null && deletingContactId === null) {
    setSyncedRevision(revision);
    setContacts((previous) => mergeContactRows(previous, serverContacts));
  }

  function handleContactChange(
    idx: number,
    field: keyof ContactFormRow,
    value: string,
  ) {
    setContacts((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, [field]: value, isDirty: true } : c,
      ),
    );
  }

  function addContactRow() {
    setContacts((prev) => [
      ...prev,
      {
        clientId: crypto.randomUUID(),
        name: "",
        email: "",
        role: "",
        linkedIn: "",
        isDirty: true,
        isNew: true,
      },
    ]);
  }

  async function saveContact(idx: number) {
    const c = contacts[idx];
    if (!c.name.trim()) return;
    // Rows can be added/removed while the request is in flight, so target
    // the stable clientId in every post-await updater instead of the index.
    const clientId = c.clientId;
    setContactError(null);
    setSavingContactIdx(idx);
    try {
      if (c.isNew && !applicationId) {
        // Will be saved after application creation; just mark not dirty
        setContacts((prev) =>
          prev.map((row) =>
            row.clientId === clientId ? { ...row, isDirty: false } : row,
          ),
        );
        return;
      }
      if (!applicationId) return;
      if (c.isNew) {
        const saved = await createContact(applicationId, {
          name: c.name,
          email: c.email,
          role: c.role,
          linkedIn: c.linkedIn,
        });
        setContacts((prev) =>
          prev.map((row) =>
            row.clientId === clientId
              ? { ...row, id: saved.id, isDirty: false, isNew: false }
              : row,
          ),
        );
        queryClient.invalidateQueries({ queryKey: ["applications"] });
      } else if (c.id) {
        await updateContact(applicationId, c.id, {
          name: c.name,
          email: c.email,
          role: c.role,
          linkedIn: c.linkedIn,
        });
        setContacts((prev) =>
          prev.map((row) =>
            row.clientId === clientId ? { ...row, isDirty: false } : row,
          ),
        );
        queryClient.invalidateQueries({ queryKey: ["applications"] });
      }
    } catch {
      setContactError(t("error_contact"));
    } finally {
      setSavingContactIdx(null);
    }
  }

  async function removeContact(idx: number) {
    const c = contacts[idx];
    const clientId = c.clientId;
    setContactError(null);
    if (c.isNew || !c.id || !applicationId) {
      setContacts((prev) => prev.filter((row) => row.clientId !== clientId));
      return;
    }
    setDeletingContactId(c.id);
    try {
      await deleteContact(applicationId, c.id);
      setContacts((prev) => prev.filter((row) => row.clientId !== clientId));
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    } catch {
      setContactError(t("error_contact"));
    } finally {
      setDeletingContactId(null);
    }
  }

  async function persistPending(newApplicationId: string) {
    await Promise.all(
      contacts
        .filter((c) => c.isNew && c.name.trim())
        .map((c) =>
          createContact(newApplicationId, {
            name: c.name,
            email: c.email,
            role: c.role,
            linkedIn: c.linkedIn,
          }),
        ),
    );
  }

  return {
    contacts,
    contactError,
    savingContactIdx,
    deletingContactId,
    hasDirtyRows: contacts.some((c) => c.isDirty),
    handleContactChange,
    addContactRow,
    saveContact,
    removeContact,
    persistPending,
  };
}

export type ContactRowsState = ReturnType<typeof useContactRows>;
