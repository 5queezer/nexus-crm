"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { User as UserIcon } from "lucide-react";

interface User {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
}

async function fetchUsers(): Promise<User[]> {
  const res = await fetch("/api/admin/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

async function updateUserAdmin({ id, isAdmin }: { id: string; isAdmin: boolean }): Promise<User> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? "unknown");
  }
  return res.json();
}

interface AdminUsersProps {
  currentUserId?: string;
}

export function AdminUsers({ currentUserId }: AdminUsersProps) {
  const t = useTranslations("admin");
  const queryClient = useQueryClient();

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const mutation = useMutation({
    mutationFn: updateUserAdmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    },
    onError: (error: Error) => {
      const msg = error.message.includes("admin user is required")
        ? t("last_admin_error")
        : error.message.includes("own admin")
          ? t("self_demote_error")
          : t("error_update");
      alert(msg);
    },
  });

  if (isLoading) return <div className="py-4 text-sm text-gray-500">{t("loading")}</div>;
  if (isError) return <div className="py-4 text-sm text-red-500">{t("error_load")}</div>;

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700">
      {users.map((user) => {
        const isSelf = user.id === currentUserId;
        return (
          <div key={user.id} className="flex flex-col gap-3 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-gray-900/40">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {user.name || "User"}
                  {isSelf && (
                    <span className="ml-2 text-xs text-gray-400">({t("you")})</span>
                  )}
                </div>
                <div className="break-all text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
              </div>
            </div>
            <label className="group flex min-h-11 cursor-pointer items-center gap-2 self-start sm:self-auto">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white">
                {t("is_admin")}
              </span>
              <input
                type="checkbox"
                checked={user.isAdmin}
                disabled={mutation.isPending || isSelf}
                onChange={(e) => mutation.mutate({ id: user.id, isAdmin: e.target.checked })}
                className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                title={isSelf ? t("self_demote_error") : undefined}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
