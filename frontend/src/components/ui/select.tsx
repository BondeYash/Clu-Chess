import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { useId } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label: string;
  options: Array<{ label: string; value: string }>;
}

export function Select({ error, id, label, options, ...props }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="select-field">
      <label htmlFor={selectId}>{label}</label>
      <span className="select-field__control">
        <select
          aria-describedby={error ? `${selectId}-error` : undefined}
          aria-invalid={error ? true : undefined}
          id={selectId}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={18} />
      </span>
      {error ? (
        <span className="field__message" id={`${selectId}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
