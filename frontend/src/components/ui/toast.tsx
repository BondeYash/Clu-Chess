import { CircleAlert, CircleCheck, Info } from 'lucide-react';

export function Toast({
  message,
  tone = 'info',
}: {
  message: string;
  tone?: 'failure' | 'info' | 'success';
}) {
  const Icon =
    tone === 'success' ? CircleCheck : tone === 'failure' ? CircleAlert : Info;

  return (
    <div className={`toast toast--${tone}`} role="status">
      <Icon aria-hidden="true" size={18} />
      <span>{message}</span>
    </div>
  );
}
