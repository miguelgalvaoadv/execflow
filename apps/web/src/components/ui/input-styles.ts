import { borders, text } from '@/components/dashboard/surfaces'

export const filterInputClassName = [
  'w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-400',
  'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
  '[&>option]:bg-white [&>option]:text-slate-900', // Fix nativo dropdown invisível
].join(' ')

export const filterLabelClassName = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`
