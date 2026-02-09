export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="error-block admin-panel rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
      {message}
    </div>
  )
}
