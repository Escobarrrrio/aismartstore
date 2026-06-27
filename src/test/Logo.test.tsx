import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Logo from "@/components/Logo";

const renderLogo = (props: Parameters<typeof Logo>[0] = {}) =>
  render(
    <MemoryRouter>
      <Logo {...props} />
    </MemoryRouter>
  );

describe("Logo", () => {
  it("renders the icon and the 'Smart Store' wordmark by default", () => {
    renderLogo();
    expect(screen.getByLabelText("AI Smart Store")).toBeInTheDocument();
    expect(screen.getByText("Smart Store")).toBeInTheDocument();
  });

  it("renders the real brand icon asset, not an inline placeholder shape", () => {
    renderLogo();
    const icon = screen.getByLabelText("AI Smart Store").querySelector("img");
    expect(icon).toBeInTheDocument();
    // Guards against regressing back to a hand-drawn <svg> mark -- the
    // canonical logo is the actual uploaded brand asset (src/assets/logo.png).
    expect(icon?.getAttribute("src")).toMatch(/logo/i);
  });

  it("hides the wordmark when showWordmark is false", () => {
    renderLogo({ showWordmark: false });
    expect(screen.queryByText("Smart Store")).not.toBeInTheDocument();
  });

  it("scales the icon to the requested size", () => {
    renderLogo({ size: 64 });
    const icon = screen.getByLabelText("AI Smart Store").querySelector("img");
    expect(icon).toHaveAttribute("width", "64");
    expect(icon).toHaveAttribute("height", "64");
  });

  it("applies the inverted (white) wordmark style for dark backgrounds", () => {
    renderLogo({ invert: true });
    expect(screen.getByText("Smart Store")).toHaveClass("text-background");
  });

  it("renders as a link to home by default, and as a plain span when asLink is false", () => {
    const { container, unmount } = renderLogo();
    expect(container.querySelector("a")).toBeInTheDocument();
    unmount();

    const { container: container2 } = renderLogo({ asLink: false });
    expect(container2.querySelector("a")).not.toBeInTheDocument();
  });
});
