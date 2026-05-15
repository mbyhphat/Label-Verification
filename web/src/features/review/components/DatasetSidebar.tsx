import type { Dataset } from '@/types/domain'

type DatasetSidebarProps = {
  datasets: Dataset[]
  activeDatasetId: string | null
  loading: boolean
  onSelectDataset: (dataset: Dataset) => void
}

export function DatasetSidebar({
  datasets,
  activeDatasetId,
  loading,
  onSelectDataset,
}: DatasetSidebarProps) {
  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{ width: '232px', borderRight: '1px solid #2e3345', background: '#171a23' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #2e3345' }}
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: '#9ca3b8' }}
        >
          Datasets
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
          style={{ background: '#11141c', borderColor: '#2e3345', color: '#9ca3b8' }}
        >
          {datasets.length}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="px-4 py-3 space-y-1.5">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-10 rounded animate-pulse"
                style={{ background: '#232733' }}
              />
            ))}
          </div>
        )}

        {!loading && datasets.length === 0 && (
          <p className="px-4 py-6 text-xs text-center" style={{ color: '#9ca3b8' }}>
            No datasets visible for this user.
          </p>
        )}

        {!loading &&
          datasets.map((dataset) => {
            const isActive = activeDatasetId === dataset.id
            return (
              <button
                key={dataset.id}
                type="button"
                onClick={() => onSelectDataset(dataset)}
                className="group w-full text-left flex flex-col gap-1 transition-[background-color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#60a5fa]"
                style={{
                  padding: '9px 13px 9px 13px',
                  background: isActive ? 'rgba(96,165,250,0.10)' : 'transparent',
                  borderLeft: `3px solid ${isActive ? '#60a5fa' : 'transparent'}`,
                  paddingLeft: '13px',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#232733'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive
                    ? 'rgba(96,165,250,0.10)'
                    : 'transparent'
                }}
              >
                <span
                  className="text-[13px] font-semibold truncate"
                  style={{ color: isActive ? '#60a5fa' : '#e4e6ed' }}
                >
                  {dataset.source_key}
                </span>
                <span className="truncate text-[11px]" style={{ color: '#9ca3b8' }}>
                  {dataset.language}
                  {dataset.folder ? ` / ${dataset.folder}` : ''}
                </span>
              </button>
            )
          })}
      </div>
    </aside>
  )
}
