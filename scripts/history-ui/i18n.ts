const t = (text: string, values?: Record<string, unknown>) =>
  text.replace(/{{(.*?)}}/g, (_, key) => String(values?.[key] ?? key));
const i18n = { t, language: "en", resolvedLanguage: "en" };
export default i18n;
export const useTranslation = () => ({ t, i18n });
export const Trans = ({ children }: { children: unknown }) => children;
