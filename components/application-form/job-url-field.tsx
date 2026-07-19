"use client";

import { useState } from "react";
import { openExternalUrl } from "@/lib/external-url";

interface JobUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  editLabel: string;
  saveLabel: string;
}

export function JobUrlField({
  value,
  onChange,
  label,
  placeholder,
  editLabel,
  saveLabel,
}: JobUrlFieldProps) {
  const [isEditing, setIsEditing] = useState(!value);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {!isEditing && value ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openExternalUrl(value)}
            title={value}
            className="nexus-target min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-sm font-medium text-indigo-600 shadow-sm transition hover:bg-indigo-50 hover:underline dark:border-white/8 dark:bg-white/4 dark:text-[#828fff] dark:hover:bg-white/6"
          >
            {value}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="nexus-button-ghost shrink-0"
          >
            {editLabel}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="url"
            name="jobUrl"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="nexus-input"
            placeholder={placeholder}
          />
          {value && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="nexus-button-ghost shrink-0"
            >
              {saveLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
