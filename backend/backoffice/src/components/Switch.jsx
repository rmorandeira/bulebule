import React from 'react';

export default function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`switch${checked ? ' switch--on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    />
  );
}
