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
 * Contact row state for the application form. In create mode
 * (`applicationId === null`) rows are buffered locally and flushed with
 * `persistPending` once the application exists; otherwise rows are
 * created/updated/deleted inline against the API.
 */
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
