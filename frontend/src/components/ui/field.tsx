import { CircleAlert, CircleCheck } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';

import { classNames } from '@/lib/class-names';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  helper?: string;
  label: string;
  valid?: boolean;
}

export function Field({
  className,
  error,
  helper,
  id,
  label,
  valid = false,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const messageId = `${fieldId}-message`;

  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <span className="field__control">
        <input
          aria-describedby={error || helper ? messageId : undefined}
          aria-errormessage={error ? messageId : undefined}
          aria-invalid={error ? true : undefined}
          className={classNames(className, error && 'field__input--invalid')}
          id={fieldId}
          {...props}
        />
        {error ? (
          <CircleAlert aria-hidden="true" className="field__icon" size={18} />
        ) : null}
        {valid && !error ? (
          <CircleCheck aria-hidden="true" className="field__icon" size={18} />
        ) : null}
      </span>
      <span className="field__message" id={messageId}>
        {error ?? helper ?? '\u00a0'}
      </span>
    </div>
  );
}
