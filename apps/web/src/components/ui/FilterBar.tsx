import type { ReactNode } from 'react'
import { filterInputClassName, filterLabelClassName } from './input-styles'

type FilterBarProps = {
  children: ReactNode
  className?: string
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={[
        'flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}

export type FilterFieldWidth =
  | 'search'
  | 'select-sm'
  | 'select-md'
  | 'select-xs'
  | 'text-sm'
  | 'text-xs'

const FIELD_WIDTH_CLASS: Record<FilterFieldWidth, string> = {
  search: 'min-w-0 flex-1 sm:max-w-md',
  'select-sm': 'w-full sm:w-auto sm:min-w-[160px]',
  'select-md': 'w-full sm:w-auto sm:min-w-[180px]',
  'select-xs': 'w-full sm:w-auto sm:min-w-[140px]',
  'text-sm': 'min-w-0 flex-1 sm:max-w-[200px]',
  'text-xs': 'min-w-0 flex-1 sm:max-w-[160px]',
}

type FilterFieldProps = {
  width?: FilterFieldWidth
  children: ReactNode
}

export function FilterField({ width = 'search', children }: FilterFieldProps) {
  return <div className={FIELD_WIDTH_CLASS[width]}>{children}</div>
}

type FilterLabelProps = {
  htmlFor: string
  children: ReactNode
}

export function FilterLabel({ htmlFor, children }: FilterLabelProps) {
  return (
    <label htmlFor={htmlFor} className={filterLabelClassName}>
      {children}
    </label>
  )
}

type FilterSelectOption = {
  value: string
  label: string
}

type FilterSelectProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly FilterSelectOption[]
  width?: FilterFieldWidth
}

export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  width = 'select-sm',
}: FilterSelectProps) {
  return (
    <FilterField width={width}>
      <FilterLabel htmlFor={id}>{label}</FilterLabel>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={filterInputClassName}
      >
        {options.map((opt) => (
          <option key={opt.value || 'all'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FilterField>
  )
}

type FilterTextFieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'search' | 'text'
  width?: FilterFieldWidth
}

export function FilterTextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  width = 'text-sm',
}: FilterTextFieldProps) {
  return (
    <FilterField width={width}>
      <FilterLabel htmlFor={id}>{label}</FilterLabel>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={filterInputClassName}
      />
    </FilterField>
  )
}

type SearchFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}

/** Search input with default label and layout for list filter bars. */
export function SearchField({
  id,
  value,
  onChange,
  placeholder,
  label = 'Pesquisar',
}: SearchFieldProps) {
  return (
    <FilterTextField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type="search"
      width="search"
    />
  )
}
