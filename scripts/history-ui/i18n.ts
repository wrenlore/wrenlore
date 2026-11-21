const t = (text: string, values?: Record<string, unknown>) =>
  text.replace(/{{(.*?)}}/g, (_, key) => String(values?.[key] ?? key));
export default { t };
export const useTranslation = () => ({ t });
