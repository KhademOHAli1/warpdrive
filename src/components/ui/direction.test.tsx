// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DirectionProvider } from "./direction";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Progress } from "./Progress";
import { Sheet, SheetContent, SheetTitle } from "./sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

describe("shared UI direction", () => {
  it("opens a detail sheet from the left in RTL", () => {
    render(
      <DirectionProvider direction="rtl">
        <Sheet defaultOpen>
          <SheetContent aria-describedby={undefined}>
            <SheetTitle>Contact</SheetTitle>
          </SheetContent>
        </Sheet>
      </DirectionProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Contact" })).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("dialog", { name: "Contact" })).toHaveAttribute("data-side", "left");
  });

  it("fills progress from the right in RTL while preserving its accessible value", () => {
    render(
      <DirectionProvider direction="rtl">
        <Progress value={35} label="Upload" />
      </DirectionProvider>,
    );
    const progress = screen.getByRole("progressbar", { name: "Upload" });
    expect(progress).toHaveAttribute("aria-valuenow", "35");
    expect(progress.firstElementChild).toHaveStyle({ transform: "translateX(65%)" });
  });
  it.each(["ltr", "rtl"] as const)("carries %s into portalled popovers", (direction) => {
    render(
      <DirectionProvider direction={direction}>
        <Popover defaultOpen>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent aria-label="Date options">Options</PopoverContent>
        </Popover>
      </DirectionProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Date options" })).toHaveAttribute("dir", direction);
  });

  it.each([
    ["ltr", "ArrowRight"],
    ["rtl", "ArrowLeft"],
  ] as const)("uses %s keyboard direction for tabs", async (direction, key) => {
    render(
      <DirectionProvider direction={direction}>
        <Tabs defaultValue="first">
          <TabsList aria-label="Record">
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger value="second">Second</TabsTrigger>
          </TabsList>
          <TabsContent value="first">First panel</TabsContent>
          <TabsContent value="second">Second panel</TabsContent>
        </Tabs>
      </DirectionProvider>,
    );
    const first = screen.getByRole("tab", { name: "First" });
    first.focus();
    fireEvent.keyDown(first, { key });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Second" })).toHaveFocus());
  });
});
