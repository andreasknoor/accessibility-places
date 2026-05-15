export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <span className="text-blue-600 text-sm font-medium">♿ Accessible Places</span>
        <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex gap-2 mb-6">
          <div className="h-4 w-28 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-4  bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-4  bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Heading + intro */}
        <div className="h-8  w-3/4 bg-gray-200 rounded animate-pulse mb-3" />
        <div className="h-4  w-full max-w-2xl bg-gray-200 rounded animate-pulse mb-1" />
        <div className="h-4  w-2/3 bg-gray-200 rounded animate-pulse mb-6" />

        {/* CTA */}
        <div className="h-10 w-52 bg-blue-200 rounded-lg animate-pulse mb-8" />

        {/* Place cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white shadow-sm h-36 animate-pulse" />
          ))}
        </div>
      </main>
    </div>
  )
}
