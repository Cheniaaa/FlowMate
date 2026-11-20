import type { ButtonHTMLAttributes } from 'react';
import { Button as UiButton } from './ui/button';

export default function Button({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <UiButton type={type} variant={className.includes('button--primary') ? 'default' : 'outline'} className={`button ${className}`} {...props} />;
}
