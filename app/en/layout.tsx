import { LocaleProvider } from "@/lib/i18n"

// Server Component on purpose — a client layout here breaks Next.js's
// metadata chain, so EN SEO pages could no longer resolve generateMetadata.
// The `document.documentElement.lang = "en"` side effect used to live in a
// separate null-rendering client component (LangSetter) for exactly that
// reason; LocaleProvider now owns that attribute for every route, so this
// layout only has to declare which locale governs here.
export default function EnLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider initialLocale="en">
      {children}
    </LocaleProvider>
  )
}
