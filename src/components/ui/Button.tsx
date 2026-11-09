import type { ComponentProps } from 'react'

export function Button({ className = '', type = 'button', variant = 'primary', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button type={type} className={`button button--${variant} ${className}`} {...props} />
}
