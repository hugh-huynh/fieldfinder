import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Pill } from "./Pill";
import { Skeleton } from "./Skeleton";
import { VisuallyHidden } from "./VisuallyHidden";

describe("Button", () => {
  it("defaults to type=button so it never submits a surrounding form by accident", () => {
    render(<Button>Show venues</Button>);
    expect(screen.getByRole("button", { name: "Show venues" })).toHaveAttribute("type", "button");
  });

  it("calls onClick when activated by keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Apply</Button>);

    screen.getByRole("button", { name: "Apply" }).focus();
    await userEvent.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Apply
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("exposes the label as its accessible name and hides the icon from assistive tech", () => {
    render(<IconButton label="Use my location" icon={<svg data-testid="icon" />} />);

    const button = screen.getByRole("button", { name: "Use my location" });
    expect(button).toHaveAttribute("type", "button");
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Pill", () => {
  it("renders non-interactive text", () => {
    render(<Pill tone="brand">4 pitches</Pill>);
    expect(screen.getByText("4 pitches").tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("VisuallyHidden", () => {
  it("keeps text available to screen readers", () => {
    render(<VisuallyHidden>Loading venues</VisuallyHidden>);
    expect(screen.getByText("Loading venues")).toHaveClass("sr-only");
  });
});
