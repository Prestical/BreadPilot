// Small number formats shared by the validator and the step texts.

export function formatOhms(ohms: number): string {
  if (ohms >= 1_000_000) return `${+(ohms / 1_000_000).toFixed(2)} MΩ`;
  if (ohms >= 1000) return `${+(ohms / 1000).toFixed(2)} kΩ`;
  return `${ohms} Ω`;
}
