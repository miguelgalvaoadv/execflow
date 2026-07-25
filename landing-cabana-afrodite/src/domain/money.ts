/**
 * Dinheiro SEMPRE em centavos (inteiros). Nunca ponto flutuante em cálculo.
 * Moeda padrão: BRL.
 */
export type Cents = number;

export function assertCents(v: unknown, field = "valor"): Cents {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new RangeError(`${field} deve ser inteiro >= 0 em centavos (recebido: ${String(v)})`);
  }
  return v;
}

/** Aplica desconto percentual com arredondamento meio-para-cima, em centavos. */
export function applyPercent(amount: Cents, percent: number): Cents {
  if (percent < 0 || percent > 100) throw new RangeError(`percentual inválido: ${percent}`);
  return Math.round((amount * percent) / 100);
}

export function sum(...values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/** Formata centavos como BRL para exibição (não usar em cálculo). */
export function formatBRL(cents: Cents): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Converte reais (ex.: 450 ou 450.50) para centavos com segurança. */
export function reaisToCents(reais: number): Cents {
  return Math.round(reais * 100);
}
