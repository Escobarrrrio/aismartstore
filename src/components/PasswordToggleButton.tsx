import { Eye, EyeOff } from "lucide-react";

interface PasswordToggleButtonProps {
  visible: boolean;
  onToggle: () => void;
}

/** Show/hide toggle for password fields -- always present wherever a
 *  password is entered, per design: professional, with a small delighful
 *  hover/press bounce rather than a flat icon swap. */
const PasswordToggleButton = ({ visible, onToggle }: PasswordToggleButtonProps) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={visible ? "Hide password" : "Show password"}
    aria-pressed={visible}
    tabIndex={-1}
    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary transition-all duration-200 hover:scale-110 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full p-0.5"
  >
    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
  </button>
);

export default PasswordToggleButton;
