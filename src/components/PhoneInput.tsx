import { useMemo, useState } from "react";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { Phone } from "lucide-react";

// Regional-indicator flag emoji from an ISO 3166-1 alpha-2 code -- no image
// assets needed, renders natively wherever emoji do.
const flagEmoji = (country: string) =>
  String.fromCodePoint(...[...country.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

const countryName = (country: string) => regionNames?.of(country) ?? country;

const ALL_COUNTRIES = getCountries()
  .map((c) => ({ code: c, name: countryName(c), dial: getCountryCallingCode(c) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Best-effort default country from the browser's own locale, since that's
 *  available with zero network calls and no third-party geo-IP dependency.
 *  Falls back to South Africa -- the site's only shipping market. */
export const detectDefaultCountry = (): CountryCode => {
  if (typeof navigator === "undefined") return "ZA";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
  for (const lang of langs) {
    const region = lang?.split("-")[1]?.toUpperCase();
    if (region && ALL_COUNTRIES.some((c) => c.code === region)) return region as CountryCode;
  }
  return "ZA";
};

interface PhoneInputProps {
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  nationalNumber: string;
  onNationalNumberChange: (value: string) => void;
  error?: string;
  testId?: string;
}

/** Full E.164 phone number (e.g. "+27821234567") for validation/storage,
 *  or null while the national number doesn't yet form a valid number for
 *  the selected country. */
export const toE164 = (country: CountryCode, nationalNumber: string): string | null => {
  if (!isValidPhoneNumber(nationalNumber, country)) return null;
  return parsePhoneNumberFromString(nationalNumber, country)?.number ?? null;
};

const PhoneInput = ({ country, onCountryChange, nationalNumber, onNationalNumberChange, error, testId }: PhoneInputProps) => {
  const [focused, setFocused] = useState(false);
  const formatted = useMemo(() => new AsYouType(country).input(nationalNumber), [country, nationalNumber]);

  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5">Phone number</label>
      <div className={`flex rounded-lg border bg-muted focus-within:bg-card focus-within:ring-2 transition overflow-hidden ${
        error ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/20" : "border-input focus-within:border-secondary focus-within:ring-secondary/10"
      }`}>
        <div className="relative shrink-0">
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => onCountryChange(e.target.value as CountryCode)}
            className="h-full appearance-none bg-transparent pl-3 pr-6 py-2.5 text-sm outline-none border-r border-input cursor-pointer max-w-[6.5rem]"
          >
            {ALL_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {flagEmoji(c.code)} +{c.dial}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex-1 flex items-center">
          <Phone className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="tel"
            value={formatted}
            onChange={(e) => onNationalNumberChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="82 123 4567"
            aria-invalid={!!error}
            data-testid={testId}
            className="w-full pl-10 pr-3 py-2.5 bg-transparent text-foreground outline-none text-sm"
          />
        </div>
      </div>
      {!error && focused && nationalNumber && !isValidPhoneNumber(nationalNumber, country) && (
        <p className="text-[11px] text-muted-foreground mt-1">Keep typing — not a complete {countryName(country)} number yet.</p>
      )}
      {error && <p role="alert" className="text-[11px] text-destructive mt-1">{error}</p>}
    </div>
  );
};

export default PhoneInput;
