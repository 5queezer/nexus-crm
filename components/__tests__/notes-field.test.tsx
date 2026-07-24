// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { NotesField } from "../application-form/notes-field";

function renderField(value: string) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotesField value={value} onChange={vi.fn()} size="large" />
    </NextIntlClientProvider>,
  );
}

describe("NotesField", () => {
  it("labels notes as a bounded current summary", () => {
    renderField("current context");
    expect(screen.getByText("Summary")).toBeTruthy();
    const textarea = screen.getByRole("textbox");
    expect(textarea.getAttribute("maxlength")).toBe("10000");
    expect(screen.getByText("15/10,000")).toBeTruthy();
  });

  it("warns visibly when the summary approaches its limit", () => {
    renderField("x".repeat(9_000));
    expect(screen.getByRole("alert").textContent).toContain("approaching");
  });
});
