import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Auth from "@/pages/Auth";

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const resetPasswordForEmail = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signUp: (...args: unknown[]) => signUp(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
    },
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

const renderAuth = () =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    </HelmetProvider>
  );

describe("Auth page", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    signUp.mockReset();
    resetPasswordForEmail.mockReset();
  });

  it("renders the sign-in form by default with email and password fields", () => {
    renderAuth();
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign In" }).length).toBeGreaterThan(0);
  });

  it("submits the entered email and password to Supabase on sign in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    renderAuth();

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "correct-password" },
    });
    const submitButtons = screen.getAllByRole("button", { name: "Sign In" });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "correct-password",
      });
    });
  });

  it("does not crash and re-enables the form when Supabase returns an auth error", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    renderAuth();

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong-password" },
    });
    const submitButtons = screen.getAllByRole("button", { name: "Sign In" });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled());
    // Form should return to an interactive state, not stay stuck "loading".
    await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: "Sign In" });
      expect(buttons[buttons.length - 1]).not.toBeDisabled();
    });
  });

  it("switches to the sign-up tab and shows the create-account action", () => {
    renderAuth();
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
    // Signup is gated behind an account-type pick (residential vs
    // business/government) -- the form, and its submit button, only
    // render once a type is chosen.
    fireEvent.click(screen.getByTestId("account-type-residential"));
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("switches to the forgot-password view and sends a reset email", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    renderAuth();

    fireEvent.click(screen.getByText(/forgot your password/i));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(resetPasswordForEmail).toHaveBeenCalledWith(
        "owner@example.com",
        expect.objectContaining({ redirectTo: expect.stringContaining("/reset-password") })
      );
    });
  });
});
