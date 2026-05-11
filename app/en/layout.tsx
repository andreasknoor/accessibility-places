import { LocaleProvider } from "@/lib/i18n"
import LangSetter from "./LangSetter"

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider initialLocale="en">
      <LangSetter />
      {children}
    </LocaleProvider>
  )
}
