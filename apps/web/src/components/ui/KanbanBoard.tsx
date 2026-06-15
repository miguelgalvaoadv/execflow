import { ReactNode } from 'react'

export type KanbanColumn<T> = {
  id: string
  title: string
  items: T[]
  renderItem: (item: T) => ReactNode
}

type KanbanBoardProps<T> = {
  columns: KanbanColumn<T>[]
}

export function KanbanBoard<T>({ columns }: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
      {columns.map((col) => (
        <div key={col.id} className="flex-none w-[320px] shrink-0 snap-start flex flex-col max-h-[80vh]">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-[13px] font-semibold text-slate-700 uppercase tracking-wide">
              {col.title}
            </h3>
            <span className="bg-slate-200 text-slate-600 text-[11px] font-medium px-2 py-0.5 rounded-full">
              {col.items.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 p-1">
            {col.items.map(col.renderItem)}
            {col.items.length === 0 && (
              <div className="p-4 border border-dashed border-slate-300 rounded-lg text-center text-slate-400 text-[12px]">
                Nenhum item
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
