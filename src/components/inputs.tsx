import { ClipboardEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
export type DecimalLike = number | string


type BaseProps = {
  id?: string
  name: string;
  defaultValue?: DecimalLike | null;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
  readOnly?: boolean;
};

function toNumber(v?: DecimalLike | null) {
  const n =
    v == null
      ? 0
      : typeof v === "number"
        ? v
        : Number((v as any)?.toString?.() ?? `${v}`);
  return Number.isFinite(n) ? n : 0;
}

/** Limita magnitude para evitar overflow visual */
const MAX_MAGNITUDE = 1_000_000_000_000; // 1e12

/** Handler genérico de teclado no estilo "calculadora" */
function useDigitKeyboard({
  setUnits,
  disabled,
  clampUnits,
}: {
  setUnits: React.Dispatch<React.SetStateAction<number>>;
  disabled?: boolean;
  clampUnits: (nextUnits: number) => number;
}) {
  return function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.metaKey || e.ctrlKey) return; // permite colar, copiar, etc
    const k = e.key;
    if (k === "Enter") return;

    if (k === "Backspace") {
      e.preventDefault();
      setUnits((u) => clampUnits(Math.floor(u / 10)));
      return;
    }
    if (k === "Delete") {
      e.preventDefault();
      setUnits(() => clampUnits(0));
      return;
    }
    if (/^\d$/.test(k)) {
      e.preventDefault();
      setUnits((u) => {
        const next = u * 10 + Number(k);
        return clampUnits(next);
      });
      return;
    }
    if (k === "Tab" || k.startsWith("Arrow") || k === "Home" || k === "End") return;

    e.preventDefault();
  };
}

/* ===========================
 * IntegerInput
 * =========================== */
export function IntegerInput({
  name,
  defaultValue,
  placeholder,
  className = "w-24",
  disabled = false,
  onValueChange,
  readOnly = false,
  ...props
}: BaseProps) {
  // "units" já é o valor inteiro (sem escala)
  const initial = Math.max(0, Math.round(toNumber(defaultValue)));
  const [units, setUnits] = useState<number>(initial);

  useEffect(() => setUnits(Math.max(0, Math.round(toNumber(defaultValue)))), [defaultValue]);

  const clampUnits = (nextUnits: number) => {
    const clamped = Math.max(0, Math.min(Math.round(nextUnits), MAX_MAGNITUDE));
    if (onValueChange) onValueChange(clamped);
    return clamped;
  };

  const onKeyDown = useDigitKeyboard({ setUnits, disabled: disabled || readOnly, clampUnits });

  const display = useMemo(() => {
    return Math.min(units, MAX_MAGNITUDE).toLocaleString("pt-BR", {
      maximumFractionDigits: 0,
    });
  }, [units]);

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onKeyDown={onKeyDown}
        onChange={onValueChange ? (e) => onValueChange(Number(e.target.value)) : () => { }}
        disabled={disabled}
        className={`${className} h-9 border rounded px-2 py-1 text-right ${disabled ? "bg-gray-50 text-gray-400" : ""
          }`}
        placeholder={placeholder}
        {...props}
      />
      <input type="hidden" name={name} value={String(units)} />
    </div>
  );
}

/* ===========================
 * DecimalInput (configurável)
 * =========================== */
type DecimalInputProps = BaseProps & {
  /** Casas decimais (padrão 2, mesmo comportamento do MoneyInput) */
  fractionDigits?: number;

};

function parseDecimalText(text: string) {
  if (!text) return NaN;
  const normalized = text.trim();
  if (!normalized) return NaN;

  const cleaned = normalized.replace(/[^\d.,-]/g, "");
  if (!cleaned) return NaN;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const sepIndex = Math.max(lastComma, lastDot);

  const hasSeparator = sepIndex !== -1;
  const integerPart = hasSeparator
    ? cleaned.slice(0, sepIndex)
    : cleaned;
  const decimalPart = hasSeparator ? cleaned.slice(sepIndex + 1) : "";

  const intDigits = integerPart.replace(/[^\d-]/g, "") || "0";
  const fracDigits = decimalPart.replace(/[^\d]/g, "");

  const composed = hasSeparator ? `${intDigits}.${fracDigits}` : intDigits;
  const n = Number(composed);
  return Number.isFinite(n) ? Math.abs(n) : NaN;
}

export function DecimalInput({
  name,
  defaultValue,
  placeholder,
  className = "w-24",
  disabled = false,
  fractionDigits = 2,
  onValueChange,
  readOnly = false,
}: DecimalInputProps) {
  // escala 10^fractionDigits (ex.: 2 casas => 100)
  const scale = useMemo(() => Math.pow(10, Math.max(0, Math.floor(fractionDigits))), [fractionDigits]);

  // Armazenamos em "units" o valor inteiro já escalado (ex.: 12,34 => 1234)
  const initialUnits = Math.max(0, Math.round(toNumber(defaultValue) * scale));
  const [units, setUnits] = useState<number>(initialUnits);

  useEffect(() => {
    setUnits(Math.max(0, Math.round(toNumber(defaultValue) * scale)));
  }, [defaultValue, scale]);

  const clampUnits = (nextUnits: number) => {
    const limit = Math.round(MAX_MAGNITUDE * scale);
    const clamped = Math.max(0, Math.min(Math.round(nextUnits), limit));
    if (onValueChange) onValueChange(clamped / scale);
    return clamped;
  };

  const onKeyDown = useDigitKeyboard({ setUnits, disabled: disabled || readOnly, clampUnits });

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (disabled || readOnly) return;
    const raw = e.clipboardData?.getData("text") ?? "";
    const parsed = parseDecimalText(raw);
    if (!Number.isFinite(parsed)) return;
    e.preventDefault();
    setUnits(() => clampUnits(parsed * scale));
  };

  const value = units / scale;

  const display = useMemo(() => {
    return Math.min(value, MAX_MAGNITUDE).toLocaleString("pt-BR", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }, [value, fractionDigits]);

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onChange={onValueChange ? (e) => onValueChange(Number(e.target.value)) : () => { }}
        disabled={disabled}
        className={`${className} h-9 border rounded px-2 py-1 text-right ${disabled ? "bg-gray-50 text-gray-400" : ""
          }`}
        placeholder={placeholder}
        readOnly={readOnly}
      />
      <input type="hidden" name={name} value={value.toFixed(fractionDigits)} />
    </div>
  );
}
